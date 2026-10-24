/**
 * THE LIBRARY (fork #15 — docs/library.md). Pins:
 *   - the pure folds: outline → chapters/sections with page ranges, coverage
 *     roll-up, candidate selection, the outline text (titles only)
 *   - the full add → map → ready pipeline over a real PDF with a scripted
 *     librarian (no bookmarks → TOC fallback → key ideas)
 *   - the session tools: list_books, consult_book → a "pdf" job on the copy
 *   - THE GUARDRAIL (issue #15 "never pigeonholed"): a normal goal's roadmap
 *     run never sees book content even with a book pinned; only a "Study this
 *     book" goal does; compare mode can only file suggestions; the prompts
 *     carry the reference-not-curriculum wording
 *   - book actions: pin/unpin, Learn this section, Study this book, delete
 * Isolated LH_DATA_DIR, dynamic app imports (the goals.test discipline).
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";
import { createFauxCore, fauxAssistantMessage, fauxText, fauxToolCall, type FauxResponseStep } from "@earendil-works/pi-ai";

const TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "lh-library-"));
process.env.LH_DATA_DIR = TMP_DATA;

const { chaptersFromOutline, sectionCoverage, chapterViews, ideaCandidates, outlineText } = await import("../src/core/library.ts");
const { roadmapTaskFor, COMPARE_INSTRUCTIONS } = await import("../src/agent/subagents/roadmapper.ts");
const { composeInstructions } = await import("../src/agent/teacher-agent.ts");
const { createProberTools, createTeacherTools } = await import("../src/agent/tools.ts");
const { serviceEngineOverride } = await import("../src/server/agent-engines.ts");
const { libraryStore } = await import("../src/store/library.ts");
const { goalStore } = await import("../src/store/goals.ts");
const { chatStore } = await import("../src/store/chats.ts");
const { createTree } = await import("../src/core/plan-tree.ts");
const library = await import("../src/server/library.ts");
const goals = await import("../src/server/goals.ts");

type PiEngine = import("../src/agent/models.ts").PiEngine;

after(() => {
	serviceEngineOverride.current = undefined;
	fs.rmSync(TMP_DATA, { recursive: true, force: true });
});

const FIXTURE = path.join(import.meta.dirname, "fixtures", "sample-3page.pdf");

function fauxEngine(steps: FauxResponseStep[]): PiEngine {
	const faux = createFauxCore({ tokenSize: { min: 64, max: 64 } });
	faux.setResponses(steps);
	return { model: faux.getModel(), streamFn: faux.streamSimple } as unknown as PiEngine;
}

/** Every prompt text the engine was sent (for the guardrail checks). */
function recordingStep(seen: string[], reply: () => ReturnType<typeof fauxAssistantMessage>): FauxResponseStep {
	return ((context: { messages: { content: unknown }[] }) => {
		seen.push(JSON.stringify(context.messages));
		return reply();
	}) as unknown as FauxResponseStep;
}

async function settle(isWorking: () => boolean) {
	for (let i = 0; i < 400 && isWorking(); i++) await new Promise((r) => setTimeout(r, 10));
}

describe("core/library — outline → chapters", () => {
	it("chapters and sections get inclusive page ranges; an intro section fills the gap", () => {
		const chapters = chaptersFromOutline(
			[
				{ title: "Intro", level: 1, page: 1 },
				{ title: "RLHF", level: 1, page: 10 },
				{ title: "Reward models", level: 2, page: 12 },
				{ title: "PPO", level: 2, page: 20 },
				{ title: "Appendix", level: 1, page: 40 },
			],
			50,
		);
		assert.deepEqual(chapters.map((c) => [c.title, c.startPage, c.endPage]), [
			["Intro", 1, 9],
			["RLHF", 10, 39],
			["Appendix", 40, 50],
		]);
		const rlhf = chapters[1]!;
		assert.deepEqual(rlhf.sections.map((s) => [s.title, s.startPage, s.endPage]), [
			["RLHF (introduction)", 10, 11],
			["Reward models", 12, 19],
			["PPO", 20, 39],
		]);
		assert.equal(chapters[0]!.sections.length, 1, "a chapter without sub-entries is its own section");
		assert.equal(new Set(chapters.flatMap((c) => [c.id, ...c.sections.map((s) => s.id)])).size, 3 + 5, "ids are unique");
	});

	it("drops unresolvable/backwards entries and promotes a level-2-only outline", () => {
		const chapters = chaptersFromOutline(
			[
				{ title: "A", level: 2, page: 1 },
				{ title: "B", level: 2, page: null },
				{ title: "C", level: 2, page: 5 },
				{ title: "D", level: 2, page: 3 },
			],
			8,
		);
		assert.deepEqual(chapters.map((c) => c.title), ["A", "C"]);
	});
});

describe("core/library — coverage + candidates + outline text", () => {
	it("a section is covered when its ideas are mostly held (partly = half)", () => {
		assert.equal(sectionCoverage(["held", "held", "held", "not-yet"]), "covered");
		assert.equal(sectionCoverage(["held", "partly", "not-yet", "not-yet"]), "partly");
		assert.equal(sectionCoverage(["not-yet"]), "not-yet");
		assert.equal(sectionCoverage(null), "unknown");
	});

	it("chapter views ignore misaligned coverage (the ideas changed since)", () => {
		const chapters = [{ id: "c", title: "C", startPage: 1, endPage: 2, sections: [{ id: "s", title: "S", startPage: 1, endPage: 2, ideas: ["a", "b"] }] }];
		assert.equal(chapterViews(chapters, { graphRevision: 1, checkedAt: "", ideas: { s: ["held"] } })[0]!.sections[0]!.coverage, "unknown");
		assert.equal(chapterViews(chapters, { graphRevision: 1, checkedAt: "", ideas: { s: ["held", "held"] } })[0]!.coveredSections, 1);
	});

	it("candidates: most shared words first, never zero overlap", () => {
		const nodes = [
			{ id: "1", name: "Bananas", statement: "Fruit is yellow" },
			{ id: "2", name: "KL penalty", statement: "The KL penalty keeps the policy near the reference model" },
			{ id: "3", name: "Policy", statement: "A policy maps states to actions" },
		];
		assert.deepEqual(ideaCandidates("Why the KL penalty keeps the policy close to the reference", nodes).map((n) => n.id), ["2", "3"]);
	});

	it("the outline text carries titles and pages only — never key ideas", () => {
		const text = outlineText({
			title: "Book",
			chapters: [
				{
					id: "c",
					title: "Chapter",
					startPage: 1,
					endPage: 9,
					sections: [
						{ id: "a", title: "Alpha", startPage: 1, endPage: 4, ideas: ["SECRET IDEA"] },
						{ id: "b", title: "Beta", startPage: 5, endPage: 9, ideas: [] },
					],
				},
			],
		});
		assert.match(text, /Chapter \(pp\. 1–9\)/);
		assert.match(text, /Alpha \(pp\. 1–4\)/);
		assert.equal(text.includes("SECRET IDEA"), false);
	});
});

describe("the guardrail — books never pigeonhole the learning", () => {
	it("a normal goal's roadmap task passes through untouched; only a followed book adds its outline", () => {
		assert.equal(roadmapTaskFor("Draft now.", null), "Draft now.");
		const followed = roadmapTaskFor("Draft now.", { title: "RLHF", outline: "- Ch1 (pp. 1–9)" });
		assert.match(followed, /WORK THROUGH the book “RLHF”/);
		assert.match(followed, /Ch1 \(pp\. 1–9\)/);
	});

	it("the prompts say: reference, not curriculum; pinned ≠ consult more; compare files suggestions only", () => {
		const teacher = composeInstructions("teacher");
		assert.match(teacher, /reference, never the curriculum/);
		assert.match(teacher, /not a reason to consult more/);
		const prober = composeInstructions("prober");
		assert.match(prober, /never defines the goal or the strands/);
		assert.match(COMPARE_INSTRUCTIONS, /cannot change the roadmap/);
		assert.match(COMPARE_INSTRUCTIONS, /Never suggest reorganizing the roadmap to follow a book's order/);
	});
});

describe("server/library — add, map, act", () => {
	let bookId = "";

	it("adds a PDF and builds its map (no bookmarks → the TOC read → key ideas → ready)", async () => {
		serviceEngineOverride.current = fauxEngine([
			fauxAssistantMessage([
				fauxToolCall("submit_outline", {
					entries: [
						{ title: "Opening", level: 1, page: 1 },
						{ title: "Middle", level: 1, page: 2 },
						{ title: "Detail", level: 2, page: 3 },
					],
				}),
			]),
			(() => {
				// The ideas call names its sections by id — answer whatever it asks.
				return ((context: { messages: { content: unknown }[] }) => {
					const ids = [...JSON.stringify(context.messages).matchAll(/### \[([a-z0-9-]+)\]/g)].map((m) => m[1]!);
					return fauxAssistantMessage([fauxToolCall("submit_ideas", { sections: ids.map((id) => ({ id, ideas: [`Key idea of ${id}`] })) })]);
				}) as unknown as FauxResponseStep;
			})(),
		]);
		const book = await library.addBookFromBytes("RLHF Book.pdf", new Uint8Array(fs.readFileSync(FIXTURE)), "file");
		bookId = book.id;
		assert.ok(fs.existsSync(libraryStore.pdfPath(book.id)), "the PDF is copied into the library");
		await settle(() => library.isBookWorking(book.id));
		const ready = libraryStore.getBook(book.id)!;
		assert.equal(ready.status, "ready", ready.error);
		assert.deepEqual(ready.chapters.map((c) => c.title), ["Opening", "Middle"]);
		assert.deepEqual(ready.chapters[1]!.sections.map((s) => s.title), ["Middle (introduction)", "Detail"]);
		assert.ok(ready.chapters.every((c) => c.sections.every((s) => s.ideas.length > 0)), "every section got key ideas");
		assert.ok(ready.coverage, "a first coverage pass ran (empty graph: everything not-yet, no model call)");
		const view = library.getBookView(book.id)!;
		assert.equal(view.totalSections, 3);
		assert.equal(view.coveredSections, 0);
	});

	it("rejects non-PDFs and empty files", async () => {
		await assert.rejects(library.addBookFromBytes("x.pdf", new Uint8Array(), "file"), /empty/);
		await assert.rejects(library.addBookFromBytes("x.pdf", new TextEncoder().encode("not a pdf"), "file"), /readable PDF/);
	});

	it("session tools: list_books marks the pinned book; consult_book dispatches a pdf job on the library copy", async () => {
		const jobs: { kind: string; input: unknown }[] = [];
		const jobStore = {
			findJobByToolCallId: () => undefined,
			createJob: (j: { kind: string }) => ({ id: "job1", ...j }),
		} as never;
		const goal = goalStore.createGoal({ title: "Post-training", statement: "Learn post-training" });
		library.setBookPinned(bookId, goal.id, true);
		const libraryCtx = {
			listBooks: () => library.libraryListText(goal.id),
			resolveBook: (ref: string) => {
				const b = library.findBook(ref);
				return (b && library.bookOutline(b.id)) || `No ready book matches "${ref}"`;
			},
		};
		const teacher = createTeacherTools({
			chatId: "c",
			chatStore,
			jobStore,
			spawn: (job: { kind: string }, input: unknown) => void jobs.push({ kind: job.kind, input }),
			library: libraryCtx,
		});
		const listed = await teacher.list_books!.execute("t1", {} as never, undefined);
		assert.match((listed.content[0] as { text: string }).text, /pinned to this session's goal/);
		await teacher.consult_book!.execute("t2", { book: "rlhf", question: "What is the KL penalty for?" } as never, undefined);
		assert.equal(jobs[0]?.kind, "pdf");
		const input = jobs[0]!.input as { path: string; question: string };
		assert.equal(input.path, libraryStore.pdfPath(bookId));
		assert.match(input.question, /Its outline/);
		const unknown = await teacher.consult_book!.execute("t3", { book: "no such book", question: "x" } as never, undefined);
		assert.match((unknown.content[0] as { text: string }).text, /No ready book matches/);
		const prober = createProberTools({ chatId: "c", chatStore, deliver: () => {}, jobStore, spawn: () => {}, library: { listBooks: libraryCtx.listBooks } });
		assert.ok(prober.list_books);
		assert.equal(prober.consult_book, undefined, "the prober reads titles only");
	});

	it("GUARDRAIL: a normal goal with a pinned book drafts with no book content; compare files suggestions only", async () => {
		const goal = goalStore.createGoal({ title: "Post-training 2", statement: "Learn post-training broadly" });
		goalStore.saveRoadmap(goal.id, createTree([{ id: "rm", title: "Reward models" }], []));
		library.setBookPinned(bookId, goal.id, true);

		const seen: string[] = [];
		serviceEngineOverride.current = fauxEngine([recordingStep(seen, () => fauxAssistantMessage([fauxText("No change needed.")]))]);
		goals.sendRoadmapMessage(goal.id, "Anything to adjust?");
		await settle(() => goals.isRoadmapRunning(goal.id));
		assert.equal(seen.length, 1);
		assert.equal(seen[0]!.includes("Key idea of"), false, "no key ideas reach a normal roadmap run");
		assert.equal(seen[0]!.includes("Opening (pp."), false, "no outline reaches a normal roadmap run");

		const compareSeen: string[] = [];
		serviceEngineOverride.current = fauxEngine([
			recordingStep(compareSeen, () =>
				fauxAssistantMessage([fauxToolCall("file_suggestion", { book: bookId, suggestion: "Add a topic on the Detail section (p. 3)." })]),
			),
			fauxAssistantMessage([fauxText("Filed one suggestion.")]),
		]);
		goals.compareWithBooks(goal.id);
		await settle(() => goals.isRoadmapRunning(goal.id));
		const after = goalStore.getGoal(goal.id)!;
		assert.equal(after.suggestions.length, 1);
		assert.equal(after.suggestions[0]!.bookId, bookId);
		assert.deepEqual(after.roadmap!.nodes.map((n) => n.id), ["rm"], "compare never rewrites the roadmap");
		assert.equal(compareSeen[0]!.includes("roadmap_write"), false, "compare mode has no roadmap_write tool");
		assert.match(compareSeen[0]!, /Key idea of/, "compare is where the book's ideas belong");
	});

	it("Study this book: a separate goal that follows the book — and only it drafts from the outline", async () => {
		const seen: string[] = [];
		serviceEngineOverride.current = fauxEngine([recordingStep(seen, () => fauxAssistantMessage([fauxText("Drafted.")]))]);
		const { goalId } = goals.studyBook(bookId);
		await settle(() => goals.isRoadmapRunning(goalId));
		const goal = goalStore.getGoal(goalId)!;
		assert.equal(goal.followsBookId, bookId);
		assert.deepEqual(goal.bookIds, [bookId]);
		assert.match(goal.title, /^Study: /);
		assert.match(seen[0]!, /WORK THROUGH the book/);
		assert.deepEqual(goals.studyBook(bookId), { goalId }, "one study goal per book");
		assert.equal(library.getBookView(bookId)!.studyGoalId, goalId);
	});

	it("Learn this section: a normal session whose first message is the book context", () => {
		const section = libraryStore.getBook(bookId)!.chapters[1]!.sections[1]!;
		const { id, prompt } = library.startSectionSession(bookId, section.id);
		assert.match(prompt, /^Detail \(from /);
		const marker = chatStore.getChat(id)!.messages[0] as unknown as { customType: string; content: string };
		assert.equal(marker.customType, "book-context");
		assert.match(marker.content, /the book's order is not the lesson's order/);
		assert.throws(() => library.startSectionSession(bookId, "nope"), /Section not found/);
	});

	it("delete: removes the copy and unpins it everywhere", () => {
		const pinned = goalStore.listGoals().filter((g) => (g.bookIds ?? []).includes(bookId));
		assert.ok(pinned.length > 0);
		library.deleteBook(bookId);
		assert.equal(libraryStore.getBook(bookId), null);
		assert.equal(fs.existsSync(path.dirname(libraryStore.pdfPath(bookId))), false);
		for (const g of pinned) assert.equal((goalStore.getGoal(g.id)!.bookIds ?? []).includes(bookId), false);
	});
});
