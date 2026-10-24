/**
 * TODAY + INBOX (fork #2/#5/#6 — docs/today-inbox.md). Pins:
 *   - the pure plan folds: priority order, budget fill (first item always),
 *     topic dedupe against the continued session, recent picks over ACTIVE
 *     days, the 3-day gap
 *   - the inbox: derived 30-day auto-archive, restore restarting the clock
 *   - the service: the full plan over real stores (continue / topic /
 *     practice-less / inbox), inbox start → session + status, send to a
 *     roadmap, archive/restore, capture validation
 * Isolated LH_DATA_DIR, dynamic app imports (the goals.test discipline).
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";

const TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "lh-today-"));
process.env.LH_DATA_DIR = TMP_DATA;

const { fillBudget, isGap, recentPicks, todayCandidates, topicCandidate } = await import("../src/core/today.ts");
const { inboxArchived, inboxOpen } = await import("../src/core/contracts.ts");
const { createTree } = await import("../src/core/plan-tree.ts");
const { chatStore } = await import("../src/store/chats.ts");
const { goalStore } = await import("../src/store/goals.ts");
const { inboxStore } = await import("../src/store/inbox.ts");
const today = await import("../src/server/today.ts");
const goals = await import("../src/server/goals.ts");

type TodayItem = import("../src/core/contracts.ts").TodayItem;
type TopicView = import("../src/core/contracts.ts").TopicView;
type LhMessage = import("../src/core/native-messages.ts").LhMessage;

after(() => fs.rmSync(TMP_DATA, { recursive: true, force: true }));

const DAY = 86_400_000;
const at = (iso: string) => new Date(iso);

function topic(id: string, over: Partial<TopicView> = {}): TopicView {
	return { id, title: id, status: "not-started", available: false, prerequisites: [], sessions: [], ...over };
}

describe("core/today — the pure plan", () => {
	const cont: TodayItem = { kind: "continue", minutes: 25, chatId: "c", title: "C" };
	const top: TodayItem = { kind: "topic", minutes: 45, goalId: "g", goalTitle: "G", topicId: "t", topicTitle: "T" };
	const prac: TodayItem = { kind: "practice", minutes: 15, picks: [{ id: "n", name: "N", statement: "S" }] };
	const inb: TodayItem = { kind: "inbox", minutes: 20, itemId: "i", text: "I" };

	it("priority: continue → topic → practice → inbox", () => {
		const items = todayCandidates({
			continueSession: { id: "c", title: "C" },
			goal: { id: "g", title: "G", topics: [topic("t", { available: true })] },
			picks: [{ id: "n", name: "N", statement: "S" }],
			inbox: [{ id: "i", text: "I", createdAt: "", touchedAt: "", status: "open" }],
		});
		assert.deepEqual(items.map((i) => i.kind), ["continue", "topic", "practice", "inbox"]);
	});

	it("budget fill: in order while it fits; the first item always shows", () => {
		assert.deepEqual(fillBudget([cont, top, prac, inb], 15).map((i) => i.kind), ["continue"], "first item even over budget");
		assert.deepEqual(fillBudget([cont, top, prac, inb], 60).map((i) => i.kind), ["continue", "practice", "inbox"], "the topic doesn't fit, smaller items fill");
		assert.deepEqual(fillBudget([cont, top, prac, inb], 120).map((i) => i.kind), ["continue", "topic", "practice", "inbox"]);
		assert.deepEqual(fillBudget([], 60), []);
	});

	it("topic: skips the in-progress topic the continue item already covers", () => {
		const goal = {
			id: "g",
			title: "G",
			topics: [
				topic("a", { available: true, status: "in-progress", sessions: [{ id: "c", title: "", updatedAt: "", covered: false }] }),
				topic("b", { available: true }),
			],
		};
		assert.equal(topicCandidate(goal, "c")?.topicId, "b");
		assert.equal(topicCandidate(goal, null)?.topicId, "a", "with nothing continued, pick up the in-progress topic");
		assert.equal(topicCandidate({ id: "g", title: "G", topics: [topic("x")] }, null), null, "nothing available");
		assert.equal(topicCandidate(null, null), null);
	});

	it("recent picks: the most recent ACTIVE days, not calendar days", () => {
		const node = (id: string, day: string) => ({ id, name: id, statement: id, createdAt: `${day}T10:00:00.000Z` });
		const nodes = [node("old", "2026-01-01"), node("a", "2026-10-01"), node("b", "2026-10-20"), node("c", "2026-10-20")];
		assert.deepEqual(recentPicks(nodes, 2, 8).map((p) => p.id).sort(), ["a", "b", "c"], "two active days span three weeks");
		assert.equal(recentPicks(nodes, 7, 2).length, 2, "capped");
		assert.deepEqual(recentPicks([]), []);
	});

	it("gap: 3+ days since the last activity; no history is no gap", () => {
		const now = at("2026-10-24T12:00:00.000Z");
		assert.equal(isGap(new Date(now.getTime() - 3 * DAY).toISOString(), now), true);
		assert.equal(isGap(new Date(now.getTime() - 2 * DAY).toISOString(), now), false);
		assert.equal(isGap(null, now), false);
	});
});

describe("inbox — derived auto-archive", () => {
	const now = at("2026-10-24T00:00:00.000Z");
	it("open items untouched 30 days read as archived; nothing else ages", () => {
		const fresh = { status: "open" as const, touchedAt: "2026-10-20T00:00:00.000Z" };
		const old = { status: "open" as const, touchedAt: "2026-09-20T00:00:00.000Z" };
		assert.equal(inboxOpen(fresh, now), true);
		assert.equal(inboxArchived(old, now), true);
		assert.equal(inboxOpen(old, now), false);
		assert.equal(inboxArchived({ status: "started", touchedAt: "2020-01-01T00:00:00.000Z" }, now), false, "started items leave both lists");
	});
});

describe("server/today — over real stores", () => {
	it("capture validates; archive and restore move items; restore restarts the clock", () => {
		assert.throws(() => today.captureInboxItem("   "), /Write something/);
		const item = today.captureInboxItem("  what is a KL divergence? ");
		assert.equal(item.text, "what is a KL divergence?");
		assert.ok(today.inboxView().open.some((i) => i.id === item.id));
		today.setInboxArchived(item.id, true);
		assert.ok(today.inboxView().archived.some((i) => i.id === item.id));
		today.setInboxArchived(item.id, false);
		const restored = inboxStore.get(item.id)!;
		assert.equal(restored.status, "open");
		assert.ok(restored.touchedAt >= item.touchedAt);
		assert.throws(() => today.setInboxArchived("ib_missing", true), /not found/);
	});

	it("delete forever: archived items only", () => {
		const item = today.captureInboxItem("delete me");
		assert.throws(() => today.deleteInboxItem(item.id), /archive it first/);
		today.setInboxArchived(item.id, true);
		today.deleteInboxItem(item.id);
		assert.equal(inboxStore.get(item.id), null);
		assert.throws(() => today.deleteInboxItem(item.id), /not found/);
	});

	it("start: a teach session with the item as its first message; the item leaves the inbox", () => {
		const item = today.captureInboxItem("Why does attention scale by sqrt(d)?");
		const { id, prompt } = today.startInboxSession(item.id);
		assert.equal(prompt, "Why does attention scale by sqrt(d)?");
		assert.ok(chatStore.getChat(id));
		const after = inboxStore.get(item.id)!;
		assert.equal(after.status, "started");
		assert.equal(after.chatId, id);
		assert.equal(today.inboxView().open.some((i) => i.id === item.id), false);
	});

	it("roadmap: the item lands in the goal's conversation", async () => {
		const goal = goalStore.createGoal({ title: "Interp", statement: "Mech interp" });
		const item = today.captureInboxItem("Look into SAEs");
		today.sendInboxToRoadmap(item.id, goal.id);
		assert.match(goalStore.getGoal(goal.id)!.messages[0]!.text, /Consider adding this to the roadmap: Look into SAEs/);
		assert.equal(inboxStore.get(item.id)!.status, "sent");
		// the roadmap run refuses (no models here) and clears its liveness
		for (let i = 0; i < 100 && goals.isRoadmapRunning(goal.id); i++) await new Promise((r) => setTimeout(r, 10));
	});

	it("the full plan: continue the unfinished session, then the goal's next topic, then the inbox", () => {
		const goal = goalStore.createGoal({ title: "Safety", statement: "S" });
		goalStore.saveRoadmap(
			goal.id,
			createTree(
				[
					{ id: "first", title: "First" },
					{ id: "second", title: "Second" },
				],
				[],
			),
		);
		// An unfinished linked session past the probe: a concluded probe_done,
		// a plan, a tagged quiz on a non-sink node (the goal not yet reached).
		const chat = chatStore.createChat("Unfinished lesson");
		chatStore.saveTree(chat.id, createTree([{ id: "a", title: "A" }, { id: "goal", title: "Goal" }], [{ from: "a", to: "goal" }]));
		chatStore.saveMessages(chat.id, [
			{ id: "m0", role: "assistant", content: [{ type: "toolCall", id: "pd", name: "probe_done", arguments: {} }], timestamp: 1 },
			{ id: "m0r", role: "toolResult", toolCallId: "pd", toolName: "probe_done", content: [{ type: "text", text: "ok" }], isError: false, timestamp: 2 },
			{ id: "m2", role: "assistant", content: [{ type: "toolCall", id: "q", name: "quiz", arguments: { nodeId: "a" } }], timestamp: 3 },
		] as unknown as LhMessage[]);
		chatStore.setGoalTopic(chat.id, { goalId: goal.id, topicId: "first" });

		const plan = today.todayPlan(120);
		assert.equal(plan.budget, 120);
		const kinds = plan.items.map((i) => i.kind);
		assert.equal(kinds[0], "continue");
		const cont = plan.items[0] as Extract<TodayItem, { kind: "continue" }>;
		assert.equal(cont.chatId, chat.id);
		assert.equal(cont.goalTitle, "Safety");
		const top = plan.items.find((i) => i.kind === "topic") as Extract<TodayItem, { kind: "topic" }>;
		assert.equal(top.topicId, "second", "the continued topic is not offered twice");
		assert.ok(kinds.includes("inbox"));
		assert.ok(!kinds.includes("practice"), "an empty graph has nothing to practice");
		assert.equal(plan.gap, false);
		assert.deepEqual(today.todayPlan(15).items.map((i) => i.kind), ["continue"]);
	});

	it("parseBudget accepts only the offered budgets", () => {
		assert.equal(today.parseBudget("60"), 60);
		assert.equal(today.parseBudget("45"), 30);
		assert.equal(today.parseBudget(null), 30);
	});
});
