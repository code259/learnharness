/**
 * THE PAPERS + FEED SERVICE (forks #8, #9 — docs/papers-feed.md): the sole
 * writer of data/library/papers and data/library/feed.json.
 *
 *   papers      — add from an arXiv id/link (API metadata + the PDF), any
 *                 PDF link, a PDF file, or a web article (saved as readable
 *                 text); paper sessions; predictions + calibration
 *   feed        — a daily, forgiving shortlist: fetch the sources → keep new,
 *                 recent items (arXiv: safety terms) → free word-overlap
 *                 prefilter against the learner's profile → ONE cheap-model
 *                 pick of the top 5 with "why it's relevant to you"
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
	calibrationBands,
	FEED_DAILY_PICKS,
	visibleFeedItems,
	type CalibrationBand,
	type FeedItem,
	type FeedView,
	type PaperDepth,
	type PaperPrediction,
	type PaperRecord,
	type PaperSummary,
	type PaperView,
	type PredictionOutcome,
} from "../core/contracts.ts";
import { arxivIdOf, prefilter, profileWeights, safetyRelevant } from "../core/feed.ts";
import { allAgendas } from "../core/fieldmap.ts";
import { newPaperContextMessage } from "../core/native-messages.ts";
import { getGraph } from "../core/graph.ts";
import { emit } from "../core/events.ts";
import { pdfOutline } from "../agent/subagents/pdf-ops.ts";
import { pickFeedItems, type FeedCandidate } from "../agent/subagents/librarian.ts";
import { fetchReadable } from "../agent/tools/web.ts";
import { stores } from "./stores.ts";
import { stampStrongSlot } from "./chats.ts";
import { engineForRole, GoalServiceError } from "./agent-engines.ts";
import { arxivMetadata, FEED_SOURCES, fetchSource, type RawFeedItem } from "./feed-sources.ts";
import { getGoalView, listGoalSummaries } from "./goals.ts";

const MAX_PAPER_BYTES = 100 * 1024 * 1024;
/** Feed items older than this (by publication date) are never picked. */
const RECENT_DAYS = 10;
const PREFILTER_KEEP = 30;

// ─── papers ──────────────────────────────────────────────────────────────────

function mustPaper(id: string): PaperRecord {
	const paper = stores.paperStore.getPaper(id);
	if (!paper) throw new GoalServiceError("Paper not found", 404);
	return paper;
}

/** Injectable for tests (PDF downloads). */
export const paperDownload: { current: (url: string) => Promise<Uint8Array> } = {
	current: async (url) => {
		const res = await fetch(url, { signal: AbortSignal.timeout(120_000), headers: { "User-Agent": "Mozilla/5.0 (LearnHarness)", Accept: "application/pdf,*/*" } });
		if (!res.ok) throw new GoalServiceError(`The download failed (HTTP ${res.status})`, 400);
		const declared = Number(res.headers.get("content-length") ?? 0);
		if (declared > MAX_PAPER_BYTES) throw new GoalServiceError("That PDF is over 100 MB", 400);
		return new Uint8Array(await res.arrayBuffer());
	},
};

/** Injectable for tests (article text). */
export const articleFetch: { current: (url: string) => Promise<string> } = { current: (url) => fetchReadable(url) };

async function pdfFacts(bytes: Uint8Array): Promise<{ title: string | null; pageCount: number; tmpDir: string; tmp: string }> {
	if (bytes.length === 0) throw new GoalServiceError("That file is empty", 400);
	if (bytes.length > MAX_PAPER_BYTES) throw new GoalServiceError("That PDF is over 100 MB", 400);
	const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "lh-paper-"));
	const tmp = path.join(tmpDir, "paper.pdf");
	await fs.writeFile(tmp, bytes);
	try {
		const meta = await pdfOutline(tmp, 1);
		return { title: meta.title, pageCount: meta.pageCount, tmpDir, tmp };
	} catch {
		await fs.rm(tmpDir, { recursive: true, force: true });
		throw new GoalServiceError("That isn't a readable PDF", 400);
	}
}

async function storePdfPaper(bytes: Uint8Array, input: Omit<PaperRecord, "id" | "addedAt" | "updatedAt" | "predictions" | "version" | "pageCount" | "format">, fallbackTitle: string): Promise<PaperRecord> {
	const facts = await pdfFacts(bytes);
	try {
		const paper = stores.paperStore.createPaper({
			...input,
			title: input.title || (facts.title && facts.title.length > 3 ? facts.title : fallbackTitle) || "Untitled paper",
			format: "pdf",
			pageCount: facts.pageCount,
		});
		await fs.copyFile(facts.tmp, stores.paperStore.pdfPath(paper.id));
		return paper;
	} finally {
		await fs.rm(facts.tmpDir, { recursive: true, force: true });
	}
}

/** Add from an arXiv id/link (metadata + PDF), a PDF link, or a web article
 *  link (saved as readable text). An arXiv paper already on the shelf is
 *  returned as-is. */
export async function addPaperFromRef(ref: string, hint?: { title?: string; summary?: string }): Promise<PaperRecord> {
	const trimmed = ref.trim();
	if (!trimmed) throw new GoalServiceError("Paste an arXiv link or id, or a PDF / article link", 400);
	const arxivId = arxivIdOf(trimmed);
	if (arxivId) {
		const existing = stores.paperStore.listPapers().find((p) => p.arxivId === arxivId);
		if (existing) return existing;
		const meta = await arxivMetadata(arxivId).catch(() => null);
		const bytes = await paperDownload.current(`https://arxiv.org/pdf/${arxivId}`);
		return storePdfPaper(
			bytes,
			{ title: meta?.title ?? hint?.title ?? "", authors: meta?.authors ?? [], arxivId, abstract: meta?.summary ?? hint?.summary ?? "", source: { kind: "arxiv", name: `arXiv ${arxivId}` } },
			`arXiv ${arxivId}`,
		);
	}
	let url: URL;
	try {
		url = new URL(trimmed);
	} catch {
		throw new GoalServiceError("That isn't an arXiv id or a link", 400);
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") throw new GoalServiceError("Only http(s) links can be added", 400);
	const existing = stores.paperStore.listPapers().find((p) => p.source.name === url.toString());
	if (existing) return existing;
	if (/\.pdf$/i.test(url.pathname)) {
		const bytes = await paperDownload.current(url.toString());
		return storePdfPaper(bytes, { title: hint?.title ?? "", authors: [], abstract: hint?.summary ?? "", source: { kind: "url", name: url.toString() } }, decodeURIComponent(url.pathname.split("/").pop() ?? "").replace(/\.pdf$/i, ""));
	}
	// A web article (a lab research post): saved as readable markdown.
	const text = await articleFetch.current(url.toString()).catch((err) => {
		throw new GoalServiceError(`Couldn't read that page (${err instanceof Error ? err.message : String(err)})`, 400);
	});
	const title = hint?.title || text.match(/^# (.+)$/m)?.[1]?.trim() || url.hostname;
	const paper = stores.paperStore.createPaper({ title, authors: [], abstract: hint?.summary ?? "", source: { kind: "url", name: url.toString() }, format: "article", pageCount: 0 });
	await fs.writeFile(path.join(path.dirname(stores.paperStore.pdfPath(paper.id)), "paper.md"), text, "utf-8");
	return paper;
}

export async function addPaperFromBytes(name: string, bytes: Uint8Array): Promise<PaperRecord> {
	return storePdfPaper(bytes, { title: "", authors: [], abstract: "", source: { kind: "file", name } }, name.replace(/\.pdf$/i, "").replace(/[_-]+/g, " "));
}

function sessionsOf(paperId: string) {
	return stores.chatStore
		.listChats()
		.filter((c) => (c as { paperId?: string }).paperId === paperId)
		.map((c) => ({ id: c.id, title: c.title, updatedAt: c.updatedAt }));
}

function summaryOf(p: PaperRecord, sessions: number): PaperSummary {
	return {
		id: p.id,
		title: p.title,
		authors: p.authors,
		...(p.arxivId ? { arxivId: p.arxivId } : {}),
		addedAt: p.addedAt,
		predictions: p.predictions.length,
		sessions,
	};
}

export function listPaperSummaries(): PaperSummary[] {
	const counts = new Map<string, number>();
	for (const c of stores.chatStore.listChats()) {
		const pid = (c as { paperId?: string }).paperId;
		if (pid) counts.set(pid, (counts.get(pid) ?? 0) + 1);
	}
	return stores.paperStore.listPapers().map((p) => summaryOf(p, counts.get(p.id) ?? 0));
}

export function getPaperView(id: string): PaperView | null {
	const p = stores.paperStore.getPaper(id);
	if (!p) return null;
	const sessionList = sessionsOf(id);
	return { ...summaryOf(p, sessionList.length), abstract: p.abstract, source: p.source, format: p.format, pageCount: p.pageCount, predictionList: p.predictions, sessionList };
}

export function deletePaper(id: string): void {
	mustPaper(id);
	stores.paperStore.deletePaper(id);
}

/** "Read it": a normal teach session shaped by the paper at a depth. */
export async function startPaperSession(paperId: string, depth: PaperDepth): Promise<{ id: string; prompt: string }> {
	const paper = mustPaper(paperId);
	const articleText =
		paper.format === "article" ? await fs.readFile(path.join(path.dirname(stores.paperStore.pdfPath(paperId)), "paper.md"), "utf-8").catch(() => "") : undefined;
	const prompt = `${paper.title} (${depth} read)`;
	const chat = stores.chatStore.createChat(prompt);
	stampStrongSlot(chat.id);
	stores.chatStore.setPaperId(chat.id, paperId);
	stores.chatStore.saveMessages(chat.id, [
		newPaperContextMessage({
			paperId,
			title: paper.title,
			authors: paper.authors,
			...(paper.arxivId ? { arxivId: paper.arxivId } : {}),
			abstract: paper.abstract,
			depth,
			format: paper.format,
			...(articleText !== undefined ? { articleText } : {}),
		}),
	]);
	return { id: chat.id, prompt };
}

/** For consult_book: a PDF paper resolves like a book (no outline). */
export function paperForConsult(ref: string): { title: string; outline: string; path: string } | null {
	const papers = stores.paperStore.listPapers().filter((p) => p.format === "pdf");
	const q = ref.trim().toLowerCase();
	const paper = papers.find((p) => p.id === ref.trim()) ?? papers.find((p) => p.title.toLowerCase() === q) ?? papers.find((p) => p.title.toLowerCase().includes(q));
	return paper ? { title: paper.title, outline: `(a ${paper.pageCount}-page paper — no outline; search it for the sections you need)`, path: stores.paperStore.pdfPath(paper.id) } : null;
}

// ─── predictions ─────────────────────────────────────────────────────────────

function paperOfChat(chatId: string): PaperRecord {
	const paperId = stores.chatStore.getChat(chatId)?.paperId;
	const paper = paperId ? stores.paperStore.getPaper(paperId) : null;
	if (!paper) throw new Error("This session isn't reading a paper.");
	return paper;
}

export function recordPrediction(chatId: string, statement: string, confidence: number): PaperPrediction {
	const paper = paperOfChat(chatId);
	const prediction: PaperPrediction = {
		id: `pred_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 6)}`,
		chatId,
		statement: statement.trim(),
		confidence: Math.max(50, Math.min(99, Math.round(confidence))),
		createdAt: new Date().toISOString(),
	};
	stores.paperStore.savePaper({ ...paper, predictions: [...paper.predictions, prediction] });
	return prediction;
}

export function resolvePrediction(chatId: string, predictionId: string, outcome: PredictionOutcome): void {
	const paper = paperOfChat(chatId);
	if (!paper.predictions.some((p) => p.id === predictionId)) throw new Error(`No prediction "${predictionId}" in this session — copy the id record_prediction returned.`);
	stores.paperStore.savePaper({
		...paper,
		predictions: paper.predictions.map((p) => (p.id === predictionId ? { ...p, outcome, resolvedAt: new Date().toISOString() } : p)),
	});
}

/** "Your predictions": hit rate per confidence band across every paper. */
export function calibration(): { bands: CalibrationBand[]; open: number } {
	const all = stores.paperStore.listPapers().flatMap((p) => p.predictions);
	return { bands: calibrationBands(all), open: all.filter((p) => !p.outcome).length };
}

// ─── the feed ────────────────────────────────────────────────────────────────

interface LhFeedGlobal {
	__lhFeedScan?: boolean;
}
function fg(): LhFeedGlobal {
	return globalThis as typeof globalThis & LhFeedGlobal;
}
export function isFeedScanning(): boolean {
	return fg().__lhFeedScan === true;
}

const today = (now = new Date()) => now.toISOString().slice(0, 10);

/** The learner's interest profile: active goals (statements + topics), the
 *  field map's agendas, and recent graph propositions. */
function profileTexts(): { texts: string[]; summary: string } {
	const texts: string[] = [];
	const goalLines: string[] = [];
	for (const g of listGoalSummaries().filter((x) => x.status === "active")) {
		const view = getGoalView(g.id);
		if (!view) continue;
		texts.push(view.statement, ...view.topics.map((t) => `${t.title} ${t.summary ?? ""}`));
		goalLines.push(`- ${view.title}: ${view.statement}`);
	}
	const map = stores.fieldMapStore.read();
	const agendas = map ? allAgendas(map.areas).filter((a) => a.status === "active") : [];
	texts.push(...agendas.map((a) => `${a.title} ${a.concepts.join(" ")}`));
	const nodes = getGraph(stores.graphStore).nodes.slice(-400);
	texts.push(...nodes.map((n) => `${n.name} ${n.statement}`));
	const summary = [
		goalLines.length > 0 ? `Goals:\n${goalLines.join("\n")}` : "Goals: none yet (interested in technical AI safety broadly).",
		agendas.length > 0 ? `Research areas on their field map: ${[...new Set(map!.areas.map((a) => a.title))].join(", ")}.` : "",
		nodes.length > 0 ? `Recently learned: ${nodes.slice(-25).map((n) => n.name).join("; ")}.` : "",
	]
		.filter(Boolean)
		.join("\n");
	return { texts, summary };
}

function recentEnough(item: RawFeedItem, now: Date): boolean {
	if (!item.publishedAt) return true; // listing pages: new links are new
	return now.getTime() - Date.parse(item.publishedAt) <= RECENT_DAYS * 86_400_000;
}

/** One scan: new items → prefilter → one cheap pick (or, without a model,
 *  the prefilter's top 5 with no "why"). Sources that fail are skipped and
 *  named in the record's note. */
async function scanFeed(background: boolean, now = new Date()): Promise<void> {
	const record = stores.feedStore.read();
	const seen = new Set(record.seen);
	const failed: string[] = [];
	const fresh: (RawFeedItem & { source: string; kind: FeedItem["kind"] })[] = [];
	for (const source of FEED_SOURCES) {
		try {
			for (const item of await fetchSource(source, seen)) {
				if (seen.has(item.url) || !recentEnough(item, now)) continue;
				if (source.kind === "arxiv" && !safetyRelevant(`${item.title} ${item.summary}`)) continue;
				fresh.push({ ...item, source: source.label, kind: source.kind });
			}
		} catch {
			failed.push(source.label);
		}
	}
	const { texts, summary } = profileTexts();
	const pool = prefilter(fresh, profileWeights(texts), PREFILTER_KEEP);
	let picks: { item: (typeof pool)[number]; summary: string; why: string }[] = [];
	let note: string | undefined;
	if (pool.length > 0) {
		try {
			const engine = await engineForRole("librarian", background, "ChatGPT background use is off, so the feed was ranked without a model. Allow background use in Providers for personalized picks.");
			const candidates: FeedCandidate[] = pool.map((it, i) => ({ key: `c${i + 1}`, title: it.title, source: it.source, summary: it.summary }));
			const chosen = await pickFeedItems(summary, candidates, { engine });
			picks = chosen.map((c) => ({ item: pool[Number(c.key.slice(1)) - 1]!, summary: c.summary, why: c.why })).filter((p) => p.item);
		} catch (err) {
			note = `Ranked without a model (${err instanceof Error ? err.message : String(err)}).`;
			picks = pool.slice(0, FEED_DAILY_PICKS).map((item) => ({ item, summary: item.summary.split(/(?<=\.)\s/)[0]?.slice(0, 240) ?? "", why: "" }));
		}
	}
	const at = now.toISOString();
	const added: FeedItem[] = picks.slice(0, FEED_DAILY_PICKS).map(({ item, summary: s, why }) => ({
		id: `fi_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 6)}`,
		url: item.url,
		title: item.title,
		source: item.source,
		kind: item.kind,
		publishedAt: item.publishedAt ?? at,
		summary: s,
		why,
		...(item.arxivId ? { arxivId: item.arxivId } : {}),
		addedAt: at,
		status: "shown",
	}));
	const latest = stores.feedStore.read();
	stores.feedStore.write({
		...latest,
		lastScanDay: today(now),
		lastScanAt: at,
		error: [note, failed.length > 0 ? `Couldn't reach: ${failed.join(", ")}.` : ""].filter(Boolean).join(" ") || undefined,
		// Keep only what's still visible + today's picks (nothing piles up).
		items: [...visibleFeedItems(latest.items, now), ...added],
		seen: [...latest.seen, ...fresh.map((f) => f.url)],
	});
}

function startScan(background: boolean): boolean {
	if (isFeedScanning()) return false;
	fg().__lhFeedScan = true;
	emit("papers-changed", {});
	void scanFeed(background)
		.catch((err) => {
			console.error("[feed] scan failed:", err);
			stores.feedStore.write({ ...stores.feedStore.read(), error: `The feed couldn't refresh: ${err instanceof Error ? err.message : String(err)}` });
		})
		.finally(() => {
			fg().__lhFeedScan = false;
			emit("papers-changed", {});
		});
	return true;
}

/** The once-a-day gate (the app shell calls it on open). */
export function ensureDailyFeedScan(now = new Date()): boolean {
	if (stores.feedStore.read().lastScanDay === today(now)) return false;
	return startScan(true);
}

export function refreshFeed(): void {
	if (!startScan(false)) throw new GoalServiceError("The feed is already refreshing", 409);
}

export function getFeedView(now = new Date()): FeedView {
	const record = stores.feedStore.read();
	return {
		items: visibleFeedItems(record.items, now).filter((i) => i.status === "shown" || i.status === "added"),
		lastScanAt: record.lastScanAt ?? null,
		working: isFeedScanning(),
		...(record.error ? { error: record.error } : {}),
	};
}

function setItem(id: string, patch: Partial<FeedItem>): FeedItem {
	const record = stores.feedStore.read();
	const item = record.items.find((i) => i.id === id);
	if (!item) throw new GoalServiceError("Feed item not found", 404);
	stores.feedStore.write({ ...record, items: record.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) });
	return { ...item, ...patch };
}

export function dismissFeedItem(id: string): void {
	setItem(id, { status: "dismissed" });
}

/** "Add to papers" (and the first half of "Read it"). */
export async function addFeedItemToPapers(id: string): Promise<PaperRecord> {
	const item = stores.feedStore.read().items.find((i) => i.id === id);
	if (!item) throw new GoalServiceError("Feed item not found", 404);
	const paper = await addPaperFromRef(item.arxivId ?? item.url, { title: item.title, summary: item.summary });
	setItem(id, { status: "added", paperId: paper.id });
	return paper;
}

export async function readFeedItem(id: string, depth: PaperDepth): Promise<{ id: string; prompt: string }> {
	const paper = await addFeedItemToPapers(id);
	return startPaperSession(paper.id, depth);
}

export function captureFeedItem(id: string): void {
	const item = stores.feedStore.read().items.find((i) => i.id === id);
	if (!item) throw new GoalServiceError("Feed item not found", 404);
	stores.inboxStore.add(`${item.title} — ${item.url}`);
	setItem(id, { status: "dismissed" });
}
