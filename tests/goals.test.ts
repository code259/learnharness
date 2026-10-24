/**
 * GOALS + ROADMAPS (fork #4 — docs/goals-roadmaps.md). Pins:
 *   - the pure folds (core/goals.ts): coverage = a teach question tagged with
 *     a sink of the session map; statuses/availability/orphans; the
 *     active-week estimate (forgiving: idle weeks never count)
 *   - the store adapter (src/store/goals.ts) round trip + version refusal
 *   - roadmap_write (the plan_init protocol one scale up): validation,
 *     summaries, the pinned-topic rule
 *   - the service seams the routes and the chat-handler use: topic sessions
 *     (goal-context marker + link + prompt), the prober's offer (seed map +
 *     link; the draft refuses honestly without models), suggestions,
 *     deletion unlinking sessions
 *   - the session tool registries (offer for unlinked probers, suggest for
 *     linked sessions)
 * Runs under an isolated LH_DATA_DIR (the chat-kind discipline: the seam is
 * set before any config-loading import, so app-module imports are dynamic).
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";

const TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "lh-goals-"));
process.env.LH_DATA_DIR = TMP_DATA;

const { deriveGoalView, goalEstimate, sessionCoveredGoal, topoOrder, planSinks } = await import("../src/core/goals.ts");
const { topicSlug, CURRENT_GOAL_VERSION } = await import("../src/core/contracts.ts");
const { createTree } = await import("../src/core/plan-tree.ts");
const { goalStore } = await import("../src/store/goals.ts");
const { chatStore } = await import("../src/store/chats.ts");
const { roadmapWriteTool, roadmapperPrompt } = await import("../src/agent/subagents/roadmapper.ts");
const { createProberTools, createTeacherTools } = await import("../src/agent/tools.ts");
const goals = await import("../src/server/goals.ts");

type LhMessage = import("../src/core/native-messages.ts").LhMessage;
type GoalRecord = import("../src/core/contracts.ts").GoalRecord;
type LinkedSession = import("../src/core/goals.ts").LinkedSession;

after(() => {
	fs.rmSync(TMP_DATA, { recursive: true, force: true });
});

/** A native assistant message carrying one tagged teach quiz call. */
function quizCall(nodeId: string): LhMessage {
	return {
		id: `m_${nodeId}_${Math.random().toString(36).slice(2, 7)}`,
		role: "assistant",
		content: [{ type: "toolCall", id: `call_${nodeId}`, name: "quiz", arguments: { type: "check", nodeId } }],
		timestamp: Date.now(),
	} as unknown as LhMessage;
}

const sessionTree = createTree(
	[
		{ id: "basics", title: "Basics" },
		{ id: "goal", title: "Goal" },
	],
	[{ from: "basics", to: "goal" }],
);

function session(over: Partial<LinkedSession> & { id: string }): LinkedSession {
	return {
		title: over.id,
		createdAt: "2026-10-01T10:00:00.000Z",
		updatedAt: "2026-10-01T11:00:00.000Z",
		messages: [],
		...over,
	};
}

function goalRecord(over: Partial<GoalRecord> = {}): GoalRecord {
	return {
		id: "goal_x",
		title: "ML research",
		statement: "Do research on data-centric alignment",
		createdAt: "2026-10-01T00:00:00.000Z",
		updatedAt: "2026-10-01T00:00:00.000Z",
		status: "active",
		roadmap: createTree(
			[
				{ id: "linear-algebra", title: "Linear algebra" },
				{ id: "backprop", title: "Backprop", summary: "Derive backprop" },
				{ id: "attention", title: "Attention" },
				{ id: "rlhf", title: "RLHF" },
			],
			[
				{ from: "linear-algebra", to: "backprop" },
				{ from: "backprop", to: "attention" },
				{ from: "backprop", to: "rlhf" },
			],
		),
		messages: [],
		suggestions: [],
		...over,
	};
}

describe("core/goals — coverage of one session", () => {
	it("the plan's sinks are its goal nodes", () => {
		assert.deepEqual(planSinks(sessionTree), ["goal"]);
	});

	it("covered once a teach question is tagged with a sink (any position after)", () => {
		assert.equal(sessionCoveredGoal({ tree: sessionTree, messages: [quizCall("basics")] }), false);
		assert.equal(sessionCoveredGoal({ tree: sessionTree, messages: [quizCall("basics"), quizCall("goal")] }), true);
		assert.equal(
			sessionCoveredGoal({ tree: sessionTree, messages: [quizCall("goal"), quizCall("basics")] }),
			true,
			"visited stays covered when the lesson moves back",
		);
	});

	it("no plan, no coverage", () => {
		assert.equal(sessionCoveredGoal({ messages: [quizCall("goal")] }), false);
	});
});

describe("core/goals — the goal view", () => {
	it("statuses, availability, prerequisites, orphans, topo order", () => {
		const view = deriveGoalView(
			goalRecord(),
			[
				session({ id: "s1", tree: sessionTree, messages: [quizCall("goal")], goalTopic: { goalId: "goal_x", topicId: "linear-algebra" } }),
				session({ id: "s2", goalTopic: { goalId: "goal_x", topicId: "backprop" } }),
				session({ id: "s3", goalTopic: { goalId: "goal_x", topicId: "gone-topic" } }),
				session({ id: "other", goalTopic: { goalId: "goal_other", topicId: "backprop" } }),
			],
			false,
		);
		assert.deepEqual(view.topics.map((t) => t.id), topoOrder(goalRecord().roadmap!));
		const by = Object.fromEntries(view.topics.map((t) => [t.id, t]));
		assert.equal(by["linear-algebra"]!.status, "covered");
		assert.equal(by["linear-algebra"]!.available, false, "covered topics aren't 'next'");
		assert.equal(by.backprop!.status, "in-progress");
		assert.equal(by.backprop!.available, true);
		assert.equal(by.attention!.status, "not-started");
		assert.equal(by.attention!.available, false, "its prerequisite isn't covered yet");
		assert.deepEqual(by.attention!.prerequisites, ["backprop"]);
		assert.deepEqual(view.orphanSessions.map((s) => s.id), ["s3"]);
		assert.equal(by.backprop!.sessions.length, 1, "another goal's session never leaks in");
		assert.equal(view.coveredCount, 1);
		assert.equal(view.totalCount, 4);
		assert.equal(view.estimate, null, "one covered topic is too little history");
	});

	it("open suggestions only", () => {
		const view = deriveGoalView(
			goalRecord({
				suggestions: [
					{ id: "a", chatId: "c", text: "x", createdAt: "2026-10-01T00:00:00.000Z", status: "open" },
					{ id: "b", chatId: "c", text: "y", createdAt: "2026-10-01T00:00:00.000Z", status: "dismissed" },
				],
			}),
			[],
			true,
		);
		assert.deepEqual(view.suggestions.map((s) => s.id), ["a"]);
		assert.equal(view.working, true);
	});

	it("the estimate counts ACTIVE weeks only — time away never inflates it", () => {
		const weekA = session({ id: "a", createdAt: "2026-09-01T10:00:00.000Z", updatedAt: "2026-09-01T12:00:00.000Z" });
		const weekB = session({ id: "b", createdAt: "2026-10-20T10:00:00.000Z", updatedAt: "2026-10-20T12:00:00.000Z" });
		// 2 covered over 2 active weeks (seven idle weeks between) → 1 topic/week.
		assert.deepEqual(goalEstimate(2, 6, [weekA, weekB]), { remainingTopics: 4, activeWeeks: 4 });
		assert.equal(goalEstimate(1, 6, [weekA]), null);
		assert.equal(goalEstimate(6, 6, [weekA, weekB]), null, "nothing remaining, nothing to estimate");
	});
});

describe("contracts — topicSlug", () => {
	it("slugs free titles into plan-style ids", () => {
		assert.equal(topicSlug("Scaled Dot-Product Attention!"), "scaled-dot-product-attention");
		assert.equal(topicSlug("  ???  "), "topic");
	});
});

describe("store/goals — the adapter", () => {
	it("round trip: create, roadmap, messages, suggestions, update, list, delete", () => {
		const g = goalStore.createGoal({ title: "  Interp ", statement: "Learn mech interp" });
		assert.equal(g.title, "Interp");
		assert.equal(g.status, "active");
		assert.equal(g.roadmap, null);
		goalStore.saveRoadmap(g.id, createTree([{ id: "sae", title: "SAEs" }], []));
		goalStore.appendMessage(g.id, { role: "user", text: "hi" });
		const sg = goalStore.addSuggestion(g.id, { chatId: "chat_1", text: " drop it " });
		assert.equal(sg.text, "drop it");
		goalStore.setSuggestionStatus(g.id, sg.id, "applied");
		goalStore.update(g.id, { status: "paused", lastError: "boom" });
		let read = goalStore.getGoal(g.id)!;
		assert.equal(read.roadmap?.nodes[0]?.id, "sae");
		assert.equal(read.messages.length, 1);
		assert.equal(read.suggestions[0]?.status, "applied");
		assert.equal(read.status, "paused");
		assert.equal(read.lastError, "boom");
		assert.equal(read.version, CURRENT_GOAL_VERSION);
		goalStore.update(g.id, { lastError: null });
		read = goalStore.getGoal(g.id)!;
		assert.equal("lastError" in read, false);
		assert.ok(goalStore.listGoals().some((x) => x.id === g.id));
		assert.equal(goalStore.deleteGoal(g.id), true);
		assert.equal(goalStore.getGoal(g.id), null);
	});

	it("refuses a record stamped by a newer build", () => {
		fs.writeFileSync(path.join(TMP_DATA, "goals", "goal_future.json"), JSON.stringify({ ...goalRecord({ id: "goal_future" }), version: 99 }));
		assert.equal(goalStore.getGoal("goal_future"), null);
	});
});

describe("roadmap_write", () => {
	async function call(tool: ReturnType<typeof roadmapWriteTool>, args: unknown) {
		const res = await tool.execute("tc1", args as never, undefined);
		return JSON.parse((res.content[0] as { text: string }).text) as { ok: boolean; error?: string; topics?: number };
	}

	it("saves a validated map with summaries", async () => {
		let saved: unknown = null;
		const tool = roadmapWriteTool({ pinnedTopicIds: [], save: (t) => (saved = t) });
		const out = await call(tool, {
			mermaid: "graph TD\n  a[Alpha] --> b[Beta]",
			summaries: [{ id: "b", summary: " Understand beta. " }],
		});
		assert.deepEqual(out, { ok: true, topics: 2 });
		const tree = saved as { nodes: { id: string; summary?: string }[] };
		assert.equal(tree.nodes.find((n) => n.id === "b")?.summary, "Understand beta.");
		assert.equal(tree.nodes.find((n) => n.id === "a")?.summary, undefined);
	});

	it("returns problems instead of saving: bad slugs, cycles, dropped pinned topics", async () => {
		let saves = 0;
		const tool = roadmapWriteTool({ pinnedTopicIds: ["keep-me"], save: () => saves++ });
		assert.equal((await call(tool, { mermaid: "graph TD\n  Bad.Id --> b" })).ok, false);
		assert.match((await call(tool, { mermaid: "graph TD\n  keep-me --> b\n  b --> keep-me" })).error ?? "", /cycle/i);
		assert.match((await call(tool, { mermaid: "graph TD\n  a --> b" })).error ?? "", /keep-me/);
		assert.equal(saves, 0);
	});

	it("the prompt folds the map, the conversation, and the task", () => {
		const prompt = roadmapperPrompt({
			goalStatement: "G",
			roadmapLines: ["- [a] A: covered"],
			history: [{ id: "1", role: "user", text: "more interp", createdAt: "" }],
			task: "The learner says: more interp",
		});
		assert.match(prompt, /The learner's goal: G/);
		assert.match(prompt, /\[a\] A: covered/);
		assert.match(prompt, /Learner: more interp/);
		assert.ok(prompt.endsWith("The learner says: more interp"));
	});
});

describe("server/goals — the service seams", () => {
	it("startTopicSession: a teach session with the goal-context marker, linked, plus its first prompt", () => {
		const g = goalStore.createGoal({ title: "Safety", statement: "Technical AI safety" });
		goalStore.saveRoadmap(g.id, goalRecord().roadmap!);
		const { id, prompt } = goals.startTopicSession(g.id, "backprop");
		assert.equal(prompt, "Backprop: Derive backprop");
		const chat = chatStore.getChat(id)!;
		assert.deepEqual(chat.goalTopic, { goalId: g.id, topicId: "backprop" });
		const marker = chat.messages[0] as unknown as { role: string; customType: string; content: string; details: { topicTitle: string } };
		assert.equal(marker.role, "custom");
		assert.equal(marker.customType, "goal-context");
		assert.match(marker.content, /^\[Session context\]/);
		assert.match(
			marker.content,
			/\[backprop\] Backprop: not-started \(after: linear-algebra\)/,
			"the marker carries the roadmap's derived statuses as of the session's birth",
		);
		assert.equal(marker.details.topicTitle, "Backprop");
		assert.throws(() => goals.startTopicSession(g.id, "nope"), /Topic not found/);
		// The new session now counts on the page.
		const view = goals.getGoalView(g.id)!;
		assert.equal(view.topics.find((t) => t.id === "backprop")?.status, "in-progress");
	});

	it("startRoadmapFromChat: seed map + link; the draft refuses honestly without models", async () => {
		const chat = chatStore.createChat("learn LLMs");
		const { goalId, topicId } = goals.startRoadmapFromChat(chat.id, {
			title: "LLMs",
			goal: "Understand LLMs end to end",
			firstTopic: "Tokenization",
			firstTopicSummary: "How BPE builds a vocabulary",
			notes: "Holds linear algebra",
		});
		assert.equal(topicId, "tokenization");
		assert.deepEqual(chatStore.getChat(chat.id)!.goalTopic, { goalId, topicId });
		const seeded = goalStore.getGoal(goalId)!;
		assert.deepEqual(seeded.roadmap?.nodes.map((n) => n.id), ["tokenization"]);
		// The background draft runs and fails (no model slots in this data dir):
		// the refusal lands as lastError, liveness clears.
		for (let i = 0; i < 100 && goals.isRoadmapRunning(goalId); i++) await new Promise((r) => setTimeout(r, 10));
		assert.equal(goals.isRoadmapRunning(goalId), false);
		assert.match(goalStore.getGoal(goalId)!.lastError ?? "", /model/i);
		assert.throws(
			() => goals.startRoadmapFromChat(chat.id, { title: "x", goal: "x", firstTopic: "x", firstTopicSummary: "x", notes: "" }),
			/already belongs/,
		);
	});

	it("suggestions file from linked sessions; dismiss closes them; deletion unlinks sessions", async () => {
		const g = goalStore.createGoal({ title: "RL", statement: "RL theory" });
		goalStore.saveRoadmap(g.id, goalRecord().roadmap!);
		const { id: chatId } = goals.startTopicSession(g.id, "linear-algebra");
		goals.addRoadmapSuggestion(chatId, "He already holds linear algebra");
		const open = goals.getGoalView(g.id)!.suggestions;
		assert.equal(open.length, 1);
		goals.resolveSuggestion(g.id, open[0]!.id, "dismiss");
		assert.equal(goals.getGoalView(g.id)!.suggestions.length, 0);
		assert.throws(() => goals.addRoadmapSuggestion(chatStore.createChat("loose").id, "x"), /not part of a roadmap/);
		await goals.deleteGoal(g.id);
		assert.equal(goals.getGoalView(g.id), null);
		assert.equal(chatStore.getChat(chatId)!.goalTopic, undefined, "the session survives, ungrouped");
	});

	it("deleteGoal with sessions: the goal's sessions go too, other sessions stay", async () => {
		const g = goalStore.createGoal({ title: "Doomed", statement: "S" });
		goalStore.saveRoadmap(g.id, goalRecord().roadmap!);
		const { id: a } = goals.startTopicSession(g.id, "linear-algebra");
		const { id: b } = goals.startTopicSession(g.id, "backprop");
		const bystander = chatStore.createChat("unrelated");
		assert.deepEqual(await goals.deleteGoal(g.id, { sessions: true }), { sessionsDeleted: 2 });
		assert.equal(goalStore.getGoal(g.id), null);
		assert.equal(chatStore.getChat(a), null);
		assert.equal(chatStore.getChat(b), null);
		assert.ok(chatStore.getChat(bystander.id));
	});

	it("updateGoal validates status and title", () => {
		const g = goalStore.createGoal({ title: "T", statement: "S" });
		goals.updateGoal(g.id, { status: "archived", title: "Renamed" });
		assert.equal(goalStore.getGoal(g.id)!.status, "archived");
		assert.equal(goalStore.getGoal(g.id)!.title, "Renamed");
		assert.throws(() => goals.updateGoal(g.id, { status: "done" }), /status must be/);
		assert.throws(() => goals.updateGoal("goal_missing", {}), /Goal not found/);
	});

	it("summaries order active goals before paused and archived", () => {
		const order = goals.listGoalSummaries().map((s) => s.status);
		const rank = { active: 0, paused: 1, archived: 2 } as const;
		for (let i = 1; i < order.length; i++) assert.ok(rank[order[i - 1]!] <= rank[order[i]!]);
	});
});

describe("session tool registries", () => {
	const base = {
		chatId: "c",
		chatStore,
		deliver: () => {},
		jobStore: {} as never,
		spawn: () => {},
	};

	it("an unlinked prober can offer a roadmap; a linked one can only suggest", () => {
		const offering = createProberTools({ ...base, goals: { offer: { startRoadmap: () => ({ goalId: "g", topicId: "t" }) } } });
		assert.ok(offering.offer_roadmap);
		assert.equal(offering.suggest_roadmap_change, undefined);
		const linked = createProberTools({ ...base, goals: { suggest: { addSuggestion: () => {} } } });
		assert.ok(linked.suggest_roadmap_change);
		assert.equal(linked.offer_roadmap, undefined);
		assert.equal(createProberTools(base).offer_roadmap, undefined, "no goal wiring, no goal tools");
	});

	it("the teacher suggests only when linked", () => {
		const teacher = createTeacherTools({ chatId: "c", chatStore, jobStore: {} as never, spawn: () => {}, goals: { suggest: { addSuggestion: () => {} } } });
		assert.ok(teacher.suggest_roadmap_change);
		assert.equal(createTeacherTools({ chatId: "c", chatStore, jobStore: {} as never, spawn: () => {} }).suggest_roadmap_change, undefined);
	});

	it("offer_roadmap's result: model text + the card's goal link", async () => {
		const tools = createProberTools({ ...base, goals: { offer: { startRoadmap: () => ({ goalId: "goal_9", topicId: "tok" }) } } });
		const res = await tools.offer_roadmap!.execute(
			"tc",
			{ title: "LLMs", goal: "g", firstTopic: "Tokenization", firstTopicSummary: "s", notes: "" } as never,
			undefined,
		);
		assert.match((res.content[0] as { text: string }).text, /first topic/);
		assert.deepEqual(res.details, { goalId: "goal_9", title: "LLMs", firstTopic: "Tokenization" });
	});
});
