/**
 * PAPERS + THE FEED (forks #8, #9 — docs/papers-feed.md). Pins:
 *   - the parsers on fixed samples: arXiv Atom, RSS 2.0, Atom feeds, listing
 *     page links, article metadata (site suffix stripped)
 *   - the free ranking stage: safety terms, prefilter, arXiv ids
 *   - calibration bands and the feed's 7-day window
 *   - the service with injected network + a scripted model: add papers
 *     (arXiv → metadata + PDF, dedupe; web article → text), paper sessions
 *     (paper-context marker, paperId), predictions → calibration, the daily
 *     scan (new + recent + safety-filtered → prefilter → pick 5 with "why"),
 *     the no-model fallback, the day gate, item actions
 * Isolated LH_DATA_DIR, dynamic app imports (the goals.test discipline).
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";
import { createFauxCore, fauxAssistantMessage, fauxToolCall, type FauxResponseStep } from "@earendil-works/pi-ai";

const TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "lh-papers-"));
process.env.LH_DATA_DIR = TMP_DATA;

const sources = await import("../src/server/feed-sources.ts");
const { safetyRelevant, prefilter, profileWeights, arxivIdOf } = await import("../src/core/feed.ts");
const { calibrationBands, visibleFeedItems } = await import("../src/core/contracts.ts");
const { serviceEngineOverride } = await import("../src/server/agent-engines.ts");
const { chatStore } = await import("../src/store/chats.ts");
const { feedStore, paperStore } = await import("../src/store/papers.ts");
const { inboxStore } = await import("../src/store/inbox.ts");
const papers = await import("../src/server/papers.ts");
const { createTeacherTools } = await import("../src/agent/tools.ts");
const { composeInstructions } = await import("../src/agent/teacher-agent.ts");

type FeedItem = import("../src/core/contracts.ts").FeedItem;
type PiEngine = import("../src/agent/models.ts").PiEngine;

after(() => {
	serviceEngineOverride.current = undefined;
	fs.rmSync(TMP_DATA, { recursive: true, force: true });
});

const FIXTURE_PDF = new Uint8Array(fs.readFileSync(path.join(import.meta.dirname, "fixtures", "sample-3page.pdf")));
const NOW = new Date();
const iso = (daysAgo: number) => new Date(NOW.getTime() - daysAgo * 86_400_000).toISOString();

const ARXIV = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
<entry><id>http://arxiv.org/abs/2610.11111v2</id><published>${iso(1)}</published><title>Detecting  scheming
 with probes</title><summary>We train linear probes to detect deceptive scheming in language models.</summary><author><name>Ada L</name></author><author><name>Bo C</name></author></entry>
<entry><id>http://arxiv.org/abs/2610.22222v1</id><published>${iso(1)}</published><title>Faster image codecs</title><summary>We compress images.</summary><author><name>X</name></author></entry>
<entry><id>http://arxiv.org/abs/2601.33333v1</id><published>${iso(40)}</published><title>Old alignment paper</title><summary>Reward model alignment from long ago.</summary></entry>
</feed>`;

const RSS = `<?xml version="1.0"?><rss><channel>
<item><title>Monitoring agents for sabotage</title><link>https://lab.example/monitoring</link><description>&lt;p&gt;We study &lt;b&gt;control&lt;/b&gt; monitors.&lt;/p&gt;</description><pubDate>${new Date(NOW.getTime() - 86_400_000).toUTCString()}</pubDate></item>
</channel></rss>`;

const ATOM = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Atom post</title><link rel="alternate" href="https://blog.example/post"/><updated>${iso(2)}</updated><summary>Interpretability results.</summary></entry></feed>`;

const LISTING = `<html><body>
<a href="/research/sparse-features">A</a><a href="/research/sparse-features#x">dup</a><a href="/about">no</a><a href="/research/new-evals?ref=1">B</a>
</body></html>`;

const ARTICLE = `<html><head><title>Sparse features at scale | Example Lab</title><meta name="description" content="What we found about features."></head><body></body></html>`;

describe("feed parsers (fixed samples)", () => {
	it("arXiv Atom: abs URL, clean title, abstract, authors, id", () => {
		const items = sources.parseArxivAtom(ARXIV);
		assert.equal(items.length, 3);
		assert.deepEqual(
			{ url: items[0]!.url, title: items[0]!.title, arxivId: items[0]!.arxivId, authors: items[0]!.authors },
			{ url: "https://arxiv.org/abs/2610.11111", title: "Detecting scheming with probes", arxivId: "2610.11111", authors: ["Ada L", "Bo C"] },
		);
	});

	it("RSS 2.0 and Atom: link, plain-text summary, date", () => {
		const [rss] = sources.parseRss(RSS);
		assert.equal(rss!.url, "https://lab.example/monitoring");
		assert.equal(rss!.summary, "We study control monitors.");
		assert.ok(rss!.publishedAt);
		const [atom] = sources.parseRss(ATOM);
		assert.equal(atom!.url, "https://blog.example/post");
	});

	it("listing pages: matching links, absolute, deduped, query/hash stripped", () => {
		assert.deepEqual(sources.listingLinks(LISTING, "https://lab.example/research", /^\/research\/[a-z0-9-]+$/), [
			"https://lab.example/research/sparse-features",
			"https://lab.example/research/new-evals",
		]);
	});

	it("article metadata: title with the site suffix stripped + description", () => {
		assert.deepEqual(sources.pageMeta(ARTICLE), { title: "Sparse features at scale", summary: "What we found about features." });
	});
});

describe("core — ranking, calibration, the window", () => {
	it("safety terms, prefilter by profile overlap, arXiv ids", () => {
		assert.equal(safetyRelevant("Detecting scheming with probes"), true);
		assert.equal(safetyRelevant("Faster image codecs"), false);
		const weights = profileWeights(["Sparse autoencoders find interpretable features", "probes detect deception"]);
		const ranked = prefilter(
			[
				{ title: "Unrelated topic", summary: "cooking" },
				{ title: "Sparse features", summary: "autoencoders and interpretable features" },
			],
			weights,
		);
		assert.equal(ranked[0]!.title, "Sparse features");
		assert.equal(ranked.length, 1, "zero-overlap items drop when anything overlaps");
		assert.equal(arxivIdOf("https://arxiv.org/pdf/2203.02155v3.pdf"), "2203.02155");
		assert.equal(arxivIdOf("2203.02155"), "2203.02155");
		assert.equal(arxivIdOf("https://example.com/x"), null);
	});

	it("calibration: resolved calls per 10-point band, partly = half", () => {
		const bands = calibrationBands([
			{ confidence: 72, outcome: "held" },
			{ confidence: 75, outcome: "missed" },
			{ confidence: 78, outcome: "partly" },
			{ confidence: 90, outcome: "held" },
			{ confidence: 65 },
		]);
		const seventies = bands.find((b) => b.label === "70–79%")!;
		assert.deepEqual([seventies.calls, seventies.held, seventies.partly, seventies.missed], [3, 1, 1, 1]);
		assert.equal(seventies.hitRate, 0.5);
		assert.equal(bands.find((b) => b.label === "60–69%")!.calls, 0, "unresolved predictions don't count");
	});

	it("the feed window: 7 days, dismissed hidden, newest first", () => {
		const item = (id: string, daysAgo: number, status: FeedItem["status"] = "shown"): FeedItem => ({
			id, url: id, title: id, source: "s", kind: "rss", publishedAt: iso(daysAgo), summary: "", why: "", addedAt: iso(daysAgo), status,
		});
		assert.deepEqual(visibleFeedItems([item("old", 8), item("a", 1), item("b", 0), item("gone", 0, "dismissed")], NOW).map((i) => i.id), ["b", "a"]);
	});
});

/** Network for the service tests: every source answers with a fixture. */
function installNetwork() {
	sources.feedFetch.current = async (url: string) => {
		if (url.includes("export.arxiv.org/api/query?id_list=")) return ARXIV.replace(/<entry>[\s\S]*?<\/entry>\s*<entry>[\s\S]*<\/entry>/, (m) => m.split("</entry>")[0] + "</entry>");
		if (url.includes("export.arxiv.org")) return ARXIV;
		if (url.endsWith(".xml") || url.endsWith("/feed")) return RSS;
		if (/anthropic\.com\/research$|alignment\.anthropic\.com\/$|apolloresearch\.ai\/research$|aisi\.gov\.uk\/work$/.test(url)) return "<html></html>";
		return ARTICLE;
	};
	papers.paperDownload.current = async () => FIXTURE_PDF;
	papers.articleFetch.current = async () => "# Monitoring agents\n\nThe full article text.";
}

function pickingEngine(): PiEngine {
	const faux = createFauxCore({ tokenSize: { min: 64, max: 64 } });
	const respond = ((context: { messages: unknown[] }) => {
		const keys = [...JSON.stringify(context.messages).matchAll(/\[(c\d+)\]/g)].map((m) => m[1]!);
		return fauxAssistantMessage([fauxToolCall("submit_picks", { picks: keys.slice(0, 5).map((key) => ({ key, summary: `About ${key}.`, why: "It serves your interpretability goal." })) })]);
	}) as unknown as FauxResponseStep;
	faux.setResponses(Array.from({ length: 8 }, () => respond));
	return { model: faux.getModel(), streamFn: faux.streamSimple } as unknown as PiEngine;
}

async function settle() {
	for (let i = 0; i < 500 && papers.isFeedScanning(); i++) await new Promise((r) => setTimeout(r, 10));
}

describe("server/papers — papers, sessions, predictions", () => {
	it("adds an arXiv paper (metadata + PDF) once; a web article as text", async () => {
		installNetwork();
		const paper = await papers.addPaperFromRef("https://arxiv.org/abs/2610.11111v2");
		assert.equal(paper.arxivId, "2610.11111");
		assert.equal(paper.title, "Detecting scheming with probes");
		assert.deepEqual(paper.authors, ["Ada L", "Bo C"]);
		assert.equal(paper.format, "pdf");
		assert.equal(paper.pageCount, 3);
		assert.ok(fs.existsSync(paperStore.pdfPath(paper.id)));
		assert.equal((await papers.addPaperFromRef("2610.11111")).id, paper.id, "the same arXiv paper is never added twice");
		const article = await papers.addPaperFromRef("https://lab.example/monitoring");
		assert.equal(article.format, "article");
		assert.equal(article.title, "Monitoring agents");
		await assert.rejects(papers.addPaperFromRef("not a link"), /isn't an arXiv id or a link/);
	});

	it("Read it: a normal session with the paper context + paperId; articles carry their text", async () => {
		const [pdfPaper, articlePaper] = [paperStore.listPapers().find((p) => p.format === "pdf")!, paperStore.listPapers().find((p) => p.format === "article")!];
		const { id, prompt } = await papers.startPaperSession(pdfPaper.id, "standard");
		assert.match(prompt, /\(standard read\)$/);
		const chat = chatStore.getChat(id)!;
		assert.equal(chat.paperId, pdfPaper.id);
		const marker = chat.messages[0] as unknown as { customType: string; content: string };
		assert.equal(marker.customType, "paper-context");
		assert.match(marker.content, /PREDICTS the results/);
		assert.match(marker.content, new RegExp(`consult_book \\(book: "${pdfPaper.id}"\\)`));
		const skim = await papers.startPaperSession(articlePaper.id, "skim");
		const skimMarker = chatStore.getChat(skim.id)!.messages[0] as unknown as { content: string };
		assert.match(skimMarker.content, /SKIM/);
		assert.match(skimMarker.content, /The full article text\./);
		assert.equal(papers.paperForConsult(pdfPaper.id)?.path, paperStore.pdfPath(pdfPaper.id));
		assert.equal(papers.paperForConsult(articlePaper.id), null, "articles aren't PDF-consulted");
	});

	it("predictions: recorded through the teacher's tools, resolved, and counted in calibration", async () => {
		const chatId = chatStore.listChats().map((c) => chatStore.getChat(c.id)!).find((r) => r.paperId)!.id;
		const tools = createTeacherTools({
			chatId,
			chatStore,
			jobStore: {} as never,
			spawn: () => {},
			predictions: {
				record: (s: string, c: number) => papers.recordPrediction(chatId, s, c),
				resolve: (pid: string, o: "held" | "partly" | "missed") => papers.resolvePrediction(chatId, pid, o),
			},
		});
		const recorded = await tools.record_prediction!.execute("t1", { statement: "Probes beat baselines by 10 points", confidence: 72 } as never, undefined);
		const predictionId = (recorded.content[0] as { text: string }).text.match(/id (pred_[a-z0-9_]+)/)![1]!;
		await tools.resolve_prediction!.execute("t2", { predictionId, outcome: "held" } as never, undefined);
		const { bands } = papers.calibration();
		assert.equal(bands.find((b) => b.label === "70–79%")!.held, 1);
		assert.throws(() => papers.resolvePrediction(chatId, "pred_nope", "held"), /No prediction/);
		assert.throws(() => papers.recordPrediction(chatStore.createChat("plain").id, "x", 60), /isn't reading a paper/);
		assert.match(composeInstructions("teacher"), /never guess/);
	});
});

describe("server/papers — the daily feed", () => {
	it("scans: new + recent + safety-filtered arXiv, page links, one pick with 'why'; the day gate", async () => {
		installNetwork();
		serviceEngineOverride.current = pickingEngine();
		assert.equal(papers.ensureDailyFeedScan(), true);
		await settle();
		const view = papers.getFeedView();
		const titles = view.items.map((i) => i.title);
		assert.ok(titles.includes("Detecting scheming with probes"), "the safety-relevant arXiv paper");
		assert.equal(titles.includes("Faster image codecs"), false, "arXiv non-safety filtered out");
		assert.equal(titles.includes("Old alignment paper"), false, "older than the recency window");
		assert.ok(view.items.length <= 5);
		assert.ok(view.items.every((i) => i.why === "It serves your interpretability goal."));
		assert.equal(papers.ensureDailyFeedScan(), false, "once a day");
		// A second scan never re-shows what was already considered.
		papers.refreshFeed();
		await settle();
		assert.equal(papers.getFeedView().items.length, view.items.length);
	});

	it("without a model, the prefilter's top picks still appear (with a note)", async () => {
		feedStore.write({ items: [], seen: [] });
		serviceEngineOverride.current = undefined;
		papers.refreshFeed();
		await settle();
		const view = papers.getFeedView();
		assert.ok(view.items.length > 0);
		assert.ok(view.items.every((i) => i.why === ""));
		assert.match(view.error ?? "", /Ranked without a model/);
	});

	it("item actions: dismiss hides, capture goes to the inbox, read starts a paper session", async () => {
		installNetwork();
		const [a, b, c] = papers.getFeedView().items;
		papers.dismissFeedItem(a!.id);
		assert.equal(papers.getFeedView().items.some((i) => i.id === a!.id), false);
		papers.captureFeedItem(b!.id);
		assert.ok(inboxStore.list().some((i) => i.text.includes(b!.title)));
		if (c) {
			const { id } = await papers.readFeedItem(c.id, "skim");
			assert.ok(chatStore.getChat(id)!.paperId);
			assert.equal(papers.getFeedView().items.find((i) => i.id === c.id)!.status, "added");
		}
	});
});
