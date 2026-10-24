/**
 * THE LIBRARY SERVICE (fork #15 — docs/library.md): the sole writer of
 * data/library. Adds books (a PDF copy), builds their maps in the background
 * (bookmarks first, the librarian's TOC read as fallback, then key ideas per
 * section), keeps coverage against the knowledge graph fresh ON DEMAND (when
 * a book is looked at and the graph moved), and owns the book actions.
 *
 * The guardrail lives in what this module does NOT do: nothing here writes a
 * roadmap or picks what a session teaches. Books reach roadmaps only through
 * filed suggestions (goals.compareWithBooks) or an explicit "Study this book"
 * goal; they reach sessions through consult_book or "Learn this section".
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
	type BookRecord,
	type BookSummary,
	type BookView,
	type IdeaStatus,
} from "../core/contracts.ts";
import { allSections, chapterViews, chaptersFromOutline, ideaCandidates, outlineText, type OutlineEntry } from "../core/library.ts";
import { newBookContextMessage } from "../core/native-messages.ts";
import { getGraph } from "../core/graph.ts";
import { emit } from "../core/events.ts";
import { pdfExtract, pdfOutline } from "../agent/subagents/pdf-ops.ts";
import { judgeIdeas, keyIdeas, outlineFromToc, type IdeaToJudge, type SectionText } from "../agent/subagents/librarian.ts";
import { stores } from "./stores.ts";
import { graphRevision } from "./graph.ts";
import { stampStrongSlot } from "./chats.ts";
import { engineForRole, GoalServiceError } from "./agent-engines.ts";

/** Books are big; the cap only guards against a wrong file. */
export const MAX_BOOK_BYTES = 200 * 1024 * 1024;
const SECTION_TEXT_CAP = 12_000;
const IDEAS_BATCH_CHARS = 30_000;
const IDEAS_BATCH_SECTIONS = 8;
const JUDGE_BATCH = 40;
/** Pages per pseudo-chapter when a book has no usable structure at all. */
const FALLBACK_CHUNK_PAGES = 20;

// ─── liveness (globalThis: one registry across Next module entries) ─────────

interface LhLibraryGlobal {
	__lhLibraryRuns?: Set<string>;
}
function runs(): Set<string> {
	const g = globalThis as typeof globalThis & LhLibraryGlobal;
	return (g.__lhLibraryRuns ??= new Set<string>());
}
export function isBookWorking(bookId: string): boolean {
	return runs().has(bookId);
}

/** One background run per book; failures land on the record. */
function startRun(bookId: string, work: () => Promise<void>): boolean {
	if (isBookWorking(bookId)) return false;
	runs().add(bookId);
	emit("library-changed", {});
	void (async () => {
		try {
			await work();
		} catch (err) {
			console.error(`[book ${bookId}] library run failed:`, err);
			const book = stores.libraryStore.getBook(bookId);
			if (book) {
				const reason = err instanceof Error ? err.message : String(err);
				stores.libraryStore.saveBook(book.status === "ready" ? { ...book, error: reason } : { ...book, status: "error", error: reason, progress: undefined });
			}
		} finally {
			runs().delete(bookId);
			emit("library-changed", {});
		}
	})();
	return true;
}

const BACKGROUND_REFUSAL = "ChatGPT background use is off, so the library can't read books in the background. Allow background use in Providers.";
const librarian = () => engineForRole("librarian", true, BACKGROUND_REFUSAL);

function mustBook(id: string): BookRecord {
	const book = stores.libraryStore.getBook(id);
	if (!book) throw new GoalServiceError("Book not found", 404);
	return book;
}

// ─── adding books ────────────────────────────────────────────────────────────

/** Add a book from PDF bytes: validate (parseable, sized), copy into the
 *  library, start the background map build. */
export async function addBookFromBytes(name: string, bytes: Uint8Array, kind: "file" | "url"): Promise<BookRecord> {
	if (bytes.length === 0) throw new GoalServiceError("That file is empty", 400);
	if (bytes.length > MAX_BOOK_BYTES) throw new GoalServiceError("That PDF is over 200 MB", 400);
	const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "lh-book-"));
	const tmp = path.join(tmpDir, "book.pdf");
	try {
		await fs.writeFile(tmp, bytes);
		let meta: Awaited<ReturnType<typeof pdfOutline>>;
		try {
			meta = await pdfOutline(tmp);
		} catch {
			throw new GoalServiceError("That isn't a readable PDF", 400);
		}
		const fallbackTitle = name.replace(/\.pdf$/i, "").replace(/[_-]+/g, " ").trim();
		const book = stores.libraryStore.createBook({
			title: meta.title && meta.title.length > 3 ? meta.title : fallbackTitle || "Untitled book",
			source: { kind, name },
			pageCount: meta.pageCount,
		});
		await fs.copyFile(tmp, stores.libraryStore.pdfPath(book.id));
		startIndex(book.id);
		return book;
	} finally {
		await fs.rm(tmpDir, { recursive: true, force: true });
	}
}

export async function addBookFromUrl(url: string): Promise<BookRecord> {
	let parsed: URL;
	try {
		parsed = new URL(url.trim());
	} catch {
		throw new GoalServiceError("That isn't a valid URL", 400);
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new GoalServiceError("Only http(s) links can be added", 400);
	let res: Response;
	try {
		res = await fetch(parsed, { signal: AbortSignal.timeout(180_000), headers: { Accept: "application/pdf,*/*" } });
	} catch {
		throw new GoalServiceError("Couldn't download that link", 400);
	}
	if (!res.ok) throw new GoalServiceError(`The download failed (HTTP ${res.status})`, 400);
	const declared = Number(res.headers.get("content-length") ?? 0);
	if (declared > MAX_BOOK_BYTES) throw new GoalServiceError("That PDF is over 200 MB", 400);
	const bytes = new Uint8Array(await res.arrayBuffer());
	const name = decodeURIComponent(parsed.pathname.split("/").pop() || parsed.hostname);
	return addBookFromBytes(name, bytes, "url");
}

// ─── the map build ───────────────────────────────────────────────────────────

/** Start (or resume — maps and ideas already built are kept) indexing. */
export function startIndex(bookId: string): boolean {
	return startRun(bookId, () => indexBook(bookId));
}

function save(book: BookRecord, patch: Partial<BookRecord>): BookRecord {
	return stores.libraryStore.saveBook({ ...book, ...patch });
}

async function indexBook(bookId: string): Promise<void> {
	let book = mustBook(bookId);
	book = save(book, { status: "indexing", error: undefined, progress: "Reading the book's structure" });
	const pdf = stores.libraryStore.pdfPath(bookId);

	if (book.chapters.length === 0) {
		const { entries } = await pdfOutline(pdf);
		let chapters = chaptersFromOutline(entries as OutlineEntry[], book.pageCount);
		if (chapters.length < 2) {
			book = save(book, { progress: "No bookmarks — reading the table of contents" });
			const engine = await librarian();
			const fromToc = await outlineFromToc(pdf, path.dirname(pdf), book.pageCount, { engine });
			chapters = chaptersFromOutline(fromToc, book.pageCount);
		}
		if (chapters.length === 0) {
			// No structure anywhere: even page chunks, so the rest still works.
			const entries: OutlineEntry[] = [];
			for (let p = 1; p <= book.pageCount; p += FALLBACK_CHUNK_PAGES) {
				entries.push({ title: `Pages ${p}–${Math.min(book.pageCount, p + FALLBACK_CHUNK_PAGES - 1)}`, level: 1, page: p });
			}
			chapters = chaptersFromOutline(entries, book.pageCount);
		}
		book = save(book, { chapters });
	}

	const sections = allSections(book);
	const todo = sections.filter((s) => s.ideas.length === 0);
	if (todo.length > 0) {
		const engine = await librarian();
		let done = sections.length - todo.length;
		let batch: SectionText[] = [];
		let chars = 0;
		const flush = async () => {
			if (batch.length === 0) return;
			const ideas = await keyIdeas(batch, { engine });
			book = mustBook(bookId);
			book = save(book, {
				chapters: book.chapters.map((c) => ({ ...c, sections: c.sections.map((s) => (ideas[s.id] ? { ...s, ideas: ideas[s.id]! } : s)) })),
				progress: `Key ideas: ${(done += batch.length)} / ${sections.length} sections`,
			});
			batch = [];
			chars = 0;
		};
		book = save(book, { progress: `Key ideas: ${done} / ${sections.length} sections` });
		for (const s of todo) {
			const raw = await pdfExtract(pdf, `${s.startPage}-${s.endPage}`);
			const text = raw.length > SECTION_TEXT_CAP ? `${raw.slice(0, SECTION_TEXT_CAP)}\n[…section continues]` : raw;
			if (batch.length >= IDEAS_BATCH_SECTIONS || (batch.length > 0 && chars + text.length > IDEAS_BATCH_CHARS)) await flush();
			batch.push({ id: s.id, title: s.title, text });
			chars += text.length;
		}
		await flush();
	}
	book = mustBook(bookId);
	save(book, { status: "ready", progress: undefined, error: undefined });
	// First coverage pass right away (the graph may already know a lot).
	await checkCoverage(bookId);
}

// ─── coverage ────────────────────────────────────────────────────────────────

/** Re-judge ideas not yet held against the current graph (held ideas stay
 *  held — the graph is append-mostly; a manual recheck re-judges all). */
async function checkCoverage(bookId: string, all = false): Promise<void> {
	let book = mustBook(bookId);
	if (book.status !== "ready") return;
	const revision = graphRevision();
	const nodes = getGraph(stores.graphStore).nodes;
	const previous = book.coverage?.ideas ?? {};
	const next: Record<string, IdeaStatus[]> = {};
	const items: IdeaToJudge[] = [];
	for (const s of allSections(book)) {
		const prior = previous[s.id];
		const aligned = prior && prior.length === s.ideas.length ? prior : null;
		next[s.id] = s.ideas.map((idea, i) => {
			if (!all && aligned?.[i] === "held") return "held";
			const candidates = ideaCandidates(idea, nodes, 8);
			if (candidates.length > 0) items.push({ key: `${s.id}#${i}`, idea, candidates: candidates.map((n) => ({ name: n.name, statement: n.statement })) });
			return "not-yet";
		});
	}
	if (items.length > 0) {
		const engine = await librarian();
		for (let i = 0; i < items.length; i += JUDGE_BATCH) {
			const judged = await judgeIdeas(items.slice(i, i + JUDGE_BATCH), { engine });
			for (const [key, status] of Object.entries(judged)) {
				const [sectionId, idx] = key.split("#") as [string, string];
				const list = next[sectionId];
				if (list) list[Number(idx)] = status;
			}
		}
	}
	book = mustBook(bookId);
	save(book, { coverage: { graphRevision: revision, checkedAt: new Date().toISOString(), ideas: next }, error: undefined });
}

/** Called when a book (or a pinned book's line) is looked at: recheck in
 *  the background only if the graph moved since the last check. */
export function ensureCoverageFresh(bookId: string): void {
	const book = stores.libraryStore.getBook(bookId);
	if (!book || book.status !== "ready" || isBookWorking(bookId)) return;
	if (book.coverage && book.coverage.graphRevision === graphRevision()) return;
	startRun(bookId, () => checkCoverage(bookId));
}

/** The manual "Recheck coverage": re-judges every idea. */
export function recheckCoverage(bookId: string): void {
	const book = mustBook(bookId);
	if (book.status !== "ready") throw new GoalServiceError("The book is still being read", 409);
	if (!startRun(bookId, () => checkCoverage(bookId, true))) throw new GoalServiceError("The library is already working on this book", 409);
}

// ─── views ───────────────────────────────────────────────────────────────────

function pinnedGoals(bookId: string) {
	return stores.goalStore
		.listGoals()
		.filter((g) => g.status !== "archived" && (g.bookIds ?? []).includes(bookId))
		.map((g) => ({ id: g.id, title: g.title }));
}

function summaryOf(book: BookRecord): BookSummary {
	const chapters = chapterViews(book.chapters, book.coverage);
	const sections = chapters.flatMap((c) => c.sections);
	return {
		id: book.id,
		title: book.title,
		status: book.status,
		...(book.progress ? { progress: book.progress } : {}),
		pageCount: book.pageCount,
		coveredSections: sections.filter((s) => s.coverage === "covered").length,
		totalSections: sections.length,
		pinnedGoals: pinnedGoals(book.id),
		working: isBookWorking(book.id),
	};
}

export function listBookSummaries(): BookSummary[] {
	return stores.libraryStore.listBooks().map(summaryOf);
}

/** The book page's view; looking at it is what triggers a stale recheck. */
export function getBookView(bookId: string): BookView | null {
	const book = stores.libraryStore.getBook(bookId);
	if (!book) return null;
	ensureCoverageFresh(bookId);
	return {
		...summaryOf(book),
		working: isBookWorking(bookId),
		source: book.source,
		addedAt: book.addedAt,
		...(book.error ? { error: book.error } : {}),
		chapters: chapterViews(book.chapters, book.coverage),
		coverageCheckedAt: book.coverage?.checkedAt ?? null,
		coverageStale: book.status === "ready" && (!book.coverage || book.coverage.graphRevision !== graphRevision()),
		studyGoalId: stores.goalStore.listGoals().find((g) => g.followsBookId === bookId)?.id ?? null,
	};
}

// ─── book actions ────────────────────────────────────────────────────────────

export function setBookPinned(bookId: string, goalId: string, pinned: boolean): void {
	mustBook(bookId);
	const goal = stores.goalStore.getGoal(goalId);
	if (!goal) throw new GoalServiceError("Goal not found", 404);
	const ids = new Set(goal.bookIds ?? []);
	if (pinned) ids.add(bookId);
	else ids.delete(bookId);
	stores.goalStore.update(goalId, { bookIds: [...ids] });
}

export function deleteBook(bookId: string): void {
	mustBook(bookId);
	if (isBookWorking(bookId)) throw new GoalServiceError("The library is working on this book — try again in a moment", 409);
	for (const g of stores.goalStore.listGoals()) {
		if ((g.bookIds ?? []).includes(bookId)) stores.goalStore.update(g.id, { bookIds: (g.bookIds ?? []).filter((id) => id !== bookId) });
	}
	stores.libraryStore.deleteBook(bookId);
}

function sectionOf(book: BookRecord, sectionId: string) {
	const section = allSections(book).find((s) => s.id === sectionId);
	if (!section) throw new GoalServiceError("Section not found", 404);
	return section;
}

/** "Learn this section" — an ordinary teach session (probe → plan → teach,
 *  tailored) whose message[0] names the section and makes the book its
 *  primary reference. The opt-in book-following mode, per session. */
export function startSectionSession(bookId: string, sectionId: string): { id: string; prompt: string } {
	const book = mustBook(bookId);
	const section = sectionOf(book, sectionId);
	const prompt = `${section.title} (from ${book.title})`;
	const chat = stores.chatStore.createChat(prompt);
	stampStrongSlot(chat.id);
	stores.chatStore.saveMessages(chat.id, [
		newBookContextMessage({
			bookId,
			bookTitle: book.title,
			sectionTitle: section.title,
			startPage: section.startPage,
			endPage: section.endPage,
			ideas: section.ideas,
		}),
	]);
	return { id: chat.id, prompt };
}

/** Ask a goal's roadmap agent to consider a topic for this section. */
export async function sendSectionToRoadmap(bookId: string, sectionId: string, goalId: string): Promise<void> {
	const book = mustBook(bookId);
	const section = sectionOf(book, sectionId);
	const { sendRoadmapMessage } = await import("./goals.ts");
	sendRoadmapMessage(
		goalId,
		`Consider adding a topic covering “${section.title}” from the book ${book.title} (pp. ${section.startPage}–${section.endPage}).` +
			(section.ideas.length > 0 ? ` Its key ideas: ${section.ideas.join("; ")}` : ""),
	);
}

/** The outline text for agents (titles + pages, never ideas). */
export function bookOutline(bookId: string): { title: string; outline: string; path: string } | null {
	const book = stores.libraryStore.getBook(bookId);
	if (!book || book.chapters.length === 0) return null;
	return { title: book.title, outline: outlineText(book), path: stores.libraryStore.pdfPath(bookId) };
}

/** Resolve a book the model named (id or a title fragment). */
export function findBook(ref: string): BookRecord | null {
	const books = stores.libraryStore.listBooks();
	const q = ref.trim().toLowerCase();
	return books.find((b) => b.id === ref.trim()) ?? books.find((b) => b.title.toLowerCase() === q) ?? books.find((b) => b.title.toLowerCase().includes(q)) ?? null;
}

/** list_books' text for a session: titles, pinned-for-this-goal marks, and
 *  chapter titles only — vocabulary, never a plan (the guardrail). */
export function libraryListText(goalId: string | null): string {
	const books = stores.libraryStore.listBooks().filter((b) => b.status === "ready");
	if (books.length === 0) return "The learner's library is empty.";
	const pinned = new Set(goalId ? (stores.goalStore.getGoal(goalId)?.bookIds ?? []) : []);
	return books
		.map(
			(b) =>
				`- [${b.id}] ${b.title} (${b.pageCount} pages)${pinned.has(b.id) ? " — pinned to this session's goal (preferred when you consult a book)" : ""}\n  Chapters: ${b.chapters.map((c) => c.title).join("; ")}`,
		)
		.join("\n");
}
