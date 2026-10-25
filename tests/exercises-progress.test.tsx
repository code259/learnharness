/**
 * EXERCISES + PROGRESS (forks #11, #12 — docs/exercises-progress.md). Pins:
 *   - the catalog search (title words count double; no match → empty)
 *   - the progress folds: weekly growth (flat weeks repeat, never gap),
 *     recent counts, LOCAL active days, the calendar window's Monday
 *   - the teacher's tools: find_exercises (hits / "use research" on none),
 *     suggest_exercise (http(s) only; the card's content as details); the
 *     prompt section; teacher-only registration
 *   - marks: looked up from the session's own suggest_exercise call; 404 for
 *     a card that isn't there; the route's 400 on a bad body
 *   - the progress view's aggregation, and the calendar (blank days, no
 *     future squares)
 * Isolated LH_DATA_DIR, dynamic app imports (the goals.test discipline).
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

const TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "lh-exercises-"));
process.env.LH_DATA_DIR = TMP_DATA;

const { searchCatalog, EXERCISE_CATALOG } = await import("../src/core/exercise-catalog.ts");
const { weeklyGrowth, countSince, activeDays, calendarStart, mondayOf } = await import("../src/core/progress.ts");
const { chatStore } = await import("../src/store/chats.ts");
const { graphStore } = await import("../src/store/graph.ts");
const { exerciseStore } = await import("../src/store/exercises.ts");
const progress = await import("../src/server/progress.ts");
const { createTeacherTools, createProberTools } = await import("../src/agent/tools.ts");
const { composeInstructions } = await import("../src/agent/teacher-agent.ts");
const route = await import("../app/api/exercises/[callId]/route.ts");
const { ActivityCalendar } = await import("../components/progress-page.tsx");

after(() => fs.rmSync(TMP_DATA, { recursive: true, force: true }));

const DAY = 86_400_000;
const text = (r: { content: unknown[] }) => (r.content[0] as { text: string }).text;

describe("the exercise catalog", () => {
	it("every entry has a real link and topics; ids are unique", () => {
		assert.ok(EXERCISE_CATALOG.length > 40);
		for (const e of EXERCISE_CATALOG) {
			assert.match(e.url, /^https:\/\//, e.id);
			assert.ok(e.topics.length > 0, e.id);
		}
		assert.equal(new Set(EXERCISE_CATALOG.map((e) => e.id)).size, EXERCISE_CATALOG.length);
	});

	it("search ranks by word overlap; no match returns nothing", () => {
		const hits = searchCatalog("sparse autoencoders superposition");
		assert.ok(hits.length > 0 && hits.length <= 6);
		assert.match(hits[0]!.source, /ARENA/);
		assert.deepEqual(searchCatalog("medieval pottery glazes"), []);
	});
});

describe("progress folds", () => {
	const now = new Date(2026, 9, 21, 15); // a Wednesday, local
	it("mondayOf + calendarStart are local Mondays", () => {
		assert.equal(mondayOf(now).getDay(), 1);
		assert.equal(mondayOf(now).getDate(), 19);
		assert.equal(calendarStart(26, now), "2026-04-27");
	});

	it("weekly growth is cumulative and flat weeks repeat the total", () => {
		const at = (d: Date) => d.toISOString();
		const pts = weeklyGrowth([at(new Date(2026, 9, 1)), at(new Date(2026, 9, 2)), at(new Date(2026, 9, 20))], now);
		assert.deepEqual(
			pts.map((p) => p.total),
			[2, 2, 2, 3],
		);
		assert.equal(pts[0]!.week, "2026-09-28");
		assert.deepEqual(weeklyGrowth([], now), []);
	});

	it("countSince counts the window; activeDays are distinct local dates", () => {
		assert.equal(countSince([new Date(now.getTime() - 2 * DAY).toISOString(), new Date(now.getTime() - 9 * DAY).toISOString()], 7, now), 1);
		// 23:30 local is still that day (not tomorrow's UTC date)
		const late = new Date(2026, 9, 20, 23, 30).getTime();
		assert.deepEqual(activeDays([late, late + 60_000, new Date(2026, 9, 18, 9).getTime(), 0, NaN]), ["2026-10-18", "2026-10-20"]);
	});
});

describe("the teacher's exercise tools", () => {
	const tools = createTeacherTools({ chatId: "c", chatStore, jobStore: {} as never, spawn: () => {} } as never);

	it("teacher-only, and the prompt says suggest-never-assign", () => {
		assert.ok(tools.find_exercises && tools.suggest_exercise);
		const prober = createProberTools({ chatId: "c", chatStore } as never) as Record<string, unknown>;
		assert.equal(prober.suggest_exercise, undefined);
		assert.match(composeInstructions("teacher"), /Suggest, never assign/);
	});

	it("find_exercises lists catalog hits, or points at research", async () => {
		assert.match(text(await tools.find_exercises!.execute("f1", { query: "PPO reinforcement learning" } as never, undefined)), /ARENA/);
		assert.match(text(await tools.find_exercises!.execute("f2", { query: "medieval pottery glazes" } as never, undefined)), /Use research/);
	});

	it("suggest_exercise needs a real link and returns the card as details", async () => {
		const bad = await tools.suggest_exercise!.execute("s1", { title: "X", url: "deep-ml.com", source: "Deep-ML", why: "w" } as never, undefined);
		assert.match(text(bad), /http/);
		const card = { title: "Implement softmax", url: "https://www.deep-ml.com/problems", source: "Deep-ML", why: "Practices the attention step." };
		const ok = await tools.suggest_exercise!.execute("s2", card as never, undefined);
		assert.deepEqual(ok.details, card);
	});
});

describe("marks + the progress view", () => {
	const now = Date.now();
	const chat = chatStore.createChat("Attention");
	chatStore.saveMessages(chat.id, [
		{ role: "user", content: "teach me attention", timestamp: now - 3 * DAY },
		{
			role: "assistant",
			content: [{ type: "toolCall", id: "call_ex1", name: "suggest_exercise", arguments: { title: "Implement softmax", url: "https://www.deep-ml.com/problems", source: "Deep-ML", why: "w" } }],
			timestamp: now - 3 * DAY,
		},
		{ role: "user", content: "done", timestamp: now },
	] as never);

	it("marks come from the session's own call; a missing card is a 404", () => {
		const mark = progress.markExercise(chat.id, "call_ex1", "struggled", "  the max-subtraction trick  ");
		assert.equal(mark.title, "Implement softmax");
		assert.equal(mark.note, "the max-subtraction trick");
		assert.equal(progress.getExerciseMark("call_ex1")!.status, "struggled");
		// re-marking replaces, never duplicates
		progress.markExercise(chat.id, "call_ex1", "done");
		assert.equal(exerciseStore.list().length, 1);
		assert.equal(progress.getExerciseMark("call_ex1")!.note, undefined);
		assert.throws(() => progress.markExercise(chat.id, "call_nope", "done"), /isn't in this session/);
		assert.throws(() => progress.markExercise("chat_nope", "call_ex1", "done"), /not found/);
	});

	it("the route rejects a bad body and 404s a missing card", async () => {
		const ctx = { params: Promise.resolve({ callId: "call_ex1" }) };
		const post = (body: unknown, c = ctx) => route.POST(new Request("http://x", { method: "POST", body: JSON.stringify(body) }), c);
		assert.equal((await post({ chatId: chat.id, status: "maybe" })).status, 400);
		assert.equal((await post({ chatId: chat.id, status: "done" }, { params: Promise.resolve({ callId: "call_nope" }) })).status, 404);
		assert.equal((await post({ chatId: chat.id, status: "done", note: "easy" })).status, 200);
		assert.equal(((await (await route.GET(new Request("http://x"), ctx)).json()) as { mark: { note: string } }).mark.note, "easy");
	});

	it("the view aggregates the graph, papers, marks and active days", () => {
		graphStore.appendNode({ id: "n_p1", name: "Softmax", statement: "s", aliases: [], createdAt: new Date(now - 20 * DAY).toISOString(), provenance: [] });
		graphStore.appendNode({ id: "n_p2", name: "Attention", statement: "s", aliases: [], createdAt: new Date(now - DAY).toISOString(), provenance: [] });
		const paperChat = chatStore.createChat("Paper");
		chatStore.setPaperId(paperChat.id, "paper_a");
		chatStore.setPaperId(chatStore.createChat("Paper again").id, "paper_a");

		const view = progress.getProgressView(new Date(now));
		assert.equal(view.growth.total, 2);
		assert.equal(view.growth.newThisWeek, 1);
		assert.equal(view.growth.newThisMonth, 2);
		assert.equal(view.growth.points.at(-1)!.total, 2);
		assert.equal(view.reading.papersRead, 1);
		assert.equal(view.reading.paperSessions, 2);
		assert.deepEqual([view.practice.done, view.practice.struggled], [1, 0]);
		assert.equal(view.activeDays.length, 2);
		assert.equal(view.field, null);
		assert.equal(view.calendar.weeks, 26);
	});
});

describe("the activity calendar", () => {
	it("fills active days, leaves the rest blank, and draws no future squares", () => {
		const now = new Date(2026, 9, 21, 12); // Wednesday
		const html = renderToStaticMarkup(<ActivityCalendar activeDays={["2026-10-19", "2026-10-21"]} calendar={{ start: "2026-10-12", weeks: 2 }} now={now} />);
		assert.equal((html.match(/data-active="true"/g) ?? []).length, 2);
		// 2 weeks × 7 = 14 slots; Thu–Sun of this week are future → no title
		assert.equal((html.match(/title="2026-/g) ?? []).length, 10);
		assert.match(html, /2 days with study in the last 2 weeks/);
		assert.doesNotMatch(html, /streak|behind|missed/i);
	});
});
