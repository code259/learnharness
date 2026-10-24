/**
 * THE GOALS SERVICE (fork #4 — docs/goals-roadmaps.md): the sole writer of
 * data/goals and the orchestration around the roadmap agent. Routes, the
 * chat-handler's goal tools, and the roadmap page all come through here.
 *
 *   views        — derived on every read (core/goals.ts): progress is never
 *                  stored; sessions link to topics via ChatRecord.goalTopic
 *   roadmap runs — the roadmap agent (agent/subagents/roadmapper.ts), one
 *                  run per goal at a time, fire-and-forget: liveness lives
 *                  in a globalThis registry (the turn-liveness pattern) and
 *                  every change announces goals-changed, so the page and the
 *                  sidebar refetch (notify → fetch)
 *   sessions     — starting a topic creates an ordinary teach session whose
 *                  message[0] is the goal-context marker; the prober's
 *                  roadmap offer links its own session to the first topic
 */

import { deriveGoalSummary, deriveGoalView, roadmapStatusLines, type LinkedSession } from "../core/goals.ts";
import {
	GOAL_STATUSES,
	topicSlug,
	type GoalRecord,
	type GoalStatus,
	type GoalSummary,
	type GoalView,
	type PlanTree,
} from "../core/contracts.ts";
import { createTree } from "../core/plan-tree.ts";
import { newGoalContextMessage } from "../core/native-messages.ts";
import { emit } from "../core/events.ts";
import { modelsNotConfigured, providerKeyMissing } from "../core/settings.ts";
import { graphToolsEnabled, resolveRoleSpec } from "../core/settings-resolution.ts";
import { piEngineForSpec, type PiEngine } from "../agent/models.ts";
import { chatGPTBackgroundAllowed } from "../agent/chatgpt-bridge.ts";
import { runRoadmapper } from "../agent/subagents/roadmapper.ts";
import type { OfferRoadmapInput } from "../agent/tools/goals.ts";
import { effectiveSettings, stores } from "./stores.ts";
import { providerKeyPresent } from "./keys.ts";
import { searchProvider } from "./search.ts";
import { refreshConnectionCatalog } from "./model-catalog.ts";
import { deleteChatSession, stampStrongSlot } from "./chats.ts";
import { isTurnRunning } from "./turn-liveness.ts";

/** A refusal the routes map to HTTP (status + message). */
export class GoalServiceError extends Error {
	constructor(
		message: string,
		readonly status: 400 | 404 | 409 | 503,
	) {
		super(message);
		this.name = "GoalServiceError";
	}
}

/** Route helper: run a service call, mapping GoalServiceError to its HTTP
 *  status (anything else is a real 500 and rethrows). */
export async function goalRoute(run: () => unknown | Promise<unknown>): Promise<Response> {
	try {
		const body = await run();
		return Response.json(body ?? { ok: true });
	} catch (err) {
		if (err instanceof GoalServiceError) return Response.json({ error: err.message }, { status: err.status });
		throw err;
	}
}

// ─── liveness (globalThis: one registry across Next module entries) ─────────

interface LhGoalsGlobal {
	__lhGoalRuns?: Set<string>;
}

function runs(): Set<string> {
	const g = globalThis as typeof globalThis & LhGoalsGlobal;
	return (g.__lhGoalRuns ??= new Set<string>());
}

export function isRoadmapRunning(goalId: string): boolean {
	return runs().has(goalId);
}

// ─── reads ───────────────────────────────────────────────────────────────────

/** Every session linked to a goal, as the folds need them (full records:
 *  coverage reads the transcript + plan tree). */
function linkedSessions(): LinkedSession[] {
	const { chatStore } = stores;
	return chatStore
		.listChats()
		.filter((c) => c.goalTopic)
		.map((c) => chatStore.getChat(c.id))
		.filter((r) => r !== null)
		.map((r) => ({
			id: r.id,
			title: r.title,
			createdAt: r.createdAt,
			updatedAt: r.updatedAt,
			messages: r.messages,
			tree: r.tree,
			goalTopic: r.goalTopic,
		}));
}

const STATUS_RANK: Record<GoalStatus, number> = { active: 0, paused: 1, archived: 2 };

/** The sidebar's goal rows: active first, then paused, then archived;
 *  newest activity first within each. */
export function listGoalSummaries(): GoalSummary[] {
	const sessions = linkedSessions();
	return stores.goalStore
		.listGoals()
		.map((g) => deriveGoalSummary(g, sessions, isRoadmapRunning(g.id)))
		.sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || b.updatedAt.localeCompare(a.updatedAt));
}

export function getGoalView(goalId: string): GoalView | null {
	const goal = stores.goalStore.getGoal(goalId);
	return goal ? deriveGoalView(goal, linkedSessions(), isRoadmapRunning(goalId)) : null;
}

function mustGoal(goalId: string): GoalRecord {
	const goal = stores.goalStore.getGoal(goalId);
	if (!goal) throw new GoalServiceError("Goal not found", 404);
	return goal;
}

// ─── the roadmap agent ───────────────────────────────────────────────────────

/** The roadmapper's engine — the BYOK chain for its role (the strong slot),
 *  with the same honest refusals as a turn: no model, no provider key, or
 *  ChatGPT background use off for an automatic run. */
async function roadmapEngine(background: boolean): Promise<PiEngine> {
	const spec = resolveRoleSpec("roadmapper", stores.settingsStore.readSettings());
	if (!spec) throw new GoalServiceError(modelsNotConfigured(["strong"]).error, 503);
	if (spec.provider === "chatgpt") {
		await refreshConnectionCatalog();
		if (background && !chatGPTBackgroundAllowed()) {
			throw new GoalServiceError(
				"ChatGPT background use is off, so the roadmap can't be drafted automatically. Ask for it on the roadmap page, or allow background use in Providers.",
				503,
			);
		}
	}
	if (!providerKeyPresent(spec.provider)) throw new GoalServiceError(providerKeyMissing(spec.provider, ["strong"]).error, 503);
	return piEngineForSpec(spec, background);
}

/**
 * One roadmap-agent run, fire-and-forget. Single-flight per goal (a second
 * request while one runs is a 409 for the caller). The reply lands in the
 * goal's conversation; a failure lands in lastError (shown on the page).
 */
function startRoadmapRun(goalId: string, task: string, background: boolean): void {
	if (isRoadmapRunning(goalId)) throw new GoalServiceError("The roadmap is already being updated", 409);
	runs().add(goalId);
	emit("goals-changed", {});
	void (async () => {
		try {
			const engine = await roadmapEngine(background);
			const goal = mustGoal(goalId);
			const view = deriveGoalView(goal, linkedSessions(), true);
			const pinned = [...view.topics.filter((t) => t.sessions.length > 0).map((t) => t.id)];
			const effective = effectiveSettings();
			const reply = await runRoadmapper(
				{ goalStatement: goal.statement, roadmapLines: roadmapStatusLines(view), history: goal.messages, task },
				{
					engine,
					pinnedTopicIds: pinned,
					save: (roadmap: PlanTree) => void stores.goalStore.saveRoadmap(goalId, roadmap),
					search: searchProvider,
					...(graphToolsEnabled(effective) ? { graph: { chatStore: stores.chatStore, graphStore: stores.graphStore } } : {}),
				},
			);
			if (reply) stores.goalStore.appendMessage(goalId, { role: "assistant", text: reply });
			stores.goalStore.update(goalId, { lastError: null });
		} catch (err) {
			const reason = err instanceof Error ? err.message : String(err);
			console.error(`[goal ${goalId}] roadmap run failed:`, err);
			if (stores.goalStore.getGoal(goalId)) stores.goalStore.update(goalId, { lastError: reason });
		} finally {
			runs().delete(goalId);
			emit("goals-changed", {});
		}
	})();
}

/** The roadmap page's composer: record the learner's message, then run the
 *  agent on it (foreground — the learner asked). */
export function sendRoadmapMessage(goalId: string, text: string): void {
	const t = text.trim();
	if (!t) throw new GoalServiceError("Message must be non-empty", 400);
	mustGoal(goalId);
	if (isRoadmapRunning(goalId)) throw new GoalServiceError("The roadmap is already being updated", 409);
	stores.goalStore.appendMessage(goalId, { role: "user", text: t });
	startRoadmapRun(goalId, `The learner says: ${t}`, false);
}

/** "Try again" / "Review roadmap" from the page: retries the learner's
 *  unanswered last message if there is one (a failed run), else drafts the
 *  map (still the one-topic seed) or reviews it. */
export function redraftRoadmap(goalId: string): void {
	const goal = mustGoal(goalId);
	const last = goal.messages.at(-1);
	const task =
		last?.role === "user"
			? `The learner says: ${last.text}`
			: goal.roadmap && goal.roadmap.nodes.length > 1
				? "Review the roadmap against the goal and the learner's knowledge graph, fix what is wrong, and say what you changed."
				: "Draft the full roadmap for this goal now.";
	startRoadmapRun(goalId, task, false);
}

// ─── the prober's roadmap offer ──────────────────────────────────────────────

/**
 * offer_roadmap's body: create the goal with a one-topic seed map (this
 * session's topic — the page shows something immediately and the link is
 * never orphaned), link the session, and fire the background draft.
 */
export function startRoadmapFromChat(chatId: string, input: OfferRoadmapInput): { goalId: string; topicId: string } {
	const chat = stores.chatStore.getChat(chatId);
	if (!chat) throw new Error(`Chat not found: ${chatId}`);
	if (chat.goalTopic) throw new Error("This session already belongs to a roadmap — call offer_roadmap at most once.");
	const goal = stores.goalStore.createGoal({ title: input.title, statement: input.goal });
	const topicId = topicSlug(input.firstTopic);
	stores.goalStore.saveRoadmap(
		goal.id,
		createTree([{ id: topicId, title: input.firstTopic.trim(), summary: input.firstTopicSummary.trim() }], []),
	);
	stores.chatStore.setGoalTopic(chatId, { goalId: goal.id, topicId });
	const task = [
		"Draft the full roadmap for this goal now.",
		`The learner's current session is the first topic, already on the map: [${topicId}] ${input.firstTopic} — ${input.firstTopicSummary}. Keep it (same slug) where it belongs — usually at or near the start.`,
		input.notes.trim() ? `What the session's probe established about what he holds and lacks:\n${input.notes.trim()}` : "",
	]
		.filter(Boolean)
		.join("\n\n");
	try {
		startRoadmapRun(goal.id, task, true);
	} catch (err) {
		// Never fail the offer over the draft: the goal exists, the page offers
		// a retry ("Draft roadmap"), and the probe carries on.
		stores.goalStore.update(goal.id, { lastError: err instanceof Error ? err.message : String(err) });
	}
	return { goalId: goal.id, topicId };
}

/** suggest_roadmap_change's body. */
export function addRoadmapSuggestion(chatId: string, text: string): void {
	const goalId = stores.chatStore.getChat(chatId)?.goalTopic?.goalId;
	if (!goalId || !stores.goalStore.getGoal(goalId)) throw new Error("This session is not part of a roadmap.");
	stores.goalStore.addSuggestion(goalId, { chatId, text });
}

/** Apply (the roadmap agent revises with it) or dismiss a suggestion. */
export function resolveSuggestion(goalId: string, suggestionId: string, action: "apply" | "dismiss"): void {
	const goal = mustGoal(goalId);
	const suggestion = goal.suggestions.find((s) => s.id === suggestionId && s.status === "open");
	if (!suggestion) throw new GoalServiceError("Suggestion not found", 404);
	if (action === "dismiss") {
		stores.goalStore.setSuggestionStatus(goalId, suggestionId, "dismissed");
		return;
	}
	if (isRoadmapRunning(goalId)) throw new GoalServiceError("The roadmap is already being updated", 409);
	const session = stores.chatStore.getChat(suggestion.chatId)?.title ?? "a linked session";
	stores.goalStore.setSuggestionStatus(goalId, suggestionId, "applied");
	stores.goalStore.appendMessage(goalId, { role: "user", text: `Apply the suggestion from “${session}”: ${suggestion.text}` });
	startRoadmapRun(
		goalId,
		`The learner accepted this suggestion, filed by the teaching agent during the session “${session}”:\n${suggestion.text}\nRevise the roadmap accordingly.`,
		false,
	);
}

// ─── topic sessions ──────────────────────────────────────────────────────────

/**
 * Start a session on a roadmap topic: an ordinary teach session (model
 * stamped from the strong slot, like any new session) whose message[0] is
 * the goal-context marker, linked to the topic. Returns the id and the
 * first message the client sends (the /chat/<id>?prompt= contract).
 */
export function startTopicSession(goalId: string, topicId: string): { id: string; prompt: string } {
	const goal = mustGoal(goalId);
	const view = deriveGoalView(goal, linkedSessions(), isRoadmapRunning(goalId));
	const topic = view.topics.find((t) => t.id === topicId);
	if (!topic) throw new GoalServiceError("Topic not found", 404);
	const chat = stores.chatStore.createChat(topic.title);
	stampStrongSlot(chat.id);
	stores.chatStore.saveMessages(chat.id, [
		newGoalContextMessage({
			goalId,
			goalTitle: goal.title,
			goalStatement: goal.statement,
			topicId,
			topicTitle: topic.title,
			topicSummary: topic.summary,
			roadmapLines: roadmapStatusLines(view),
		}),
	]);
	stores.chatStore.setGoalTopic(chat.id, { goalId, topicId });
	return { id: chat.id, prompt: topic.summary ? `${topic.title}: ${topic.summary}` : topic.title };
}

// ─── goal management ─────────────────────────────────────────────────────────

export function updateGoal(goalId: string, patch: { title?: unknown; status?: unknown }): void {
	mustGoal(goalId);
	const next: { title?: string; status?: GoalStatus } = {};
	if (patch.title !== undefined) {
		if (typeof patch.title !== "string" || !patch.title.trim()) throw new GoalServiceError("title must be a non-empty string", 400);
		next.title = patch.title;
	}
	if (patch.status !== undefined) {
		if (!GOAL_STATUSES.includes(patch.status as GoalStatus)) throw new GoalServiceError("status must be active, paused, or archived", 400);
		next.status = patch.status as GoalStatus;
	}
	stores.goalStore.update(goalId, next);
}

/**
 * Delete a goal. By default its sessions survive, unlinked (they return to
 * the ungrouped list). With `sessions: true` they are deleted too — through
 * the same session deletion the sidebar uses (preserve-graph: the knowledge
 * graph keeps what they taught). Busy sessions refuse the whole delete up
 * front, so nothing is half-done; the goal goes last.
 */
export async function deleteGoal(goalId: string, opts: { sessions?: boolean } = {}): Promise<{ sessionsDeleted: number }> {
	mustGoal(goalId);
	if (isRoadmapRunning(goalId)) throw new GoalServiceError("The roadmap is being updated — try again in a moment", 409);
	const linked = linkedSessions().filter((s) => s.goalTopic?.goalId === goalId);
	let sessionsDeleted = 0;
	if (opts.sessions) {
		const busy = linked.filter((s) => isTurnRunning(s.id));
		if (busy.length > 0) {
			throw new GoalServiceError(`Wait for “${busy[0]!.title}” to finish its turn, then try again.`, 409);
		}
		for (const s of linked) {
			const outcome = await deleteChatSession(s.id, "preserve-graph");
			if (!outcome.ok) {
				throw new GoalServiceError(`Couldn't delete “${s.title}”: ${outcome.error} The roadmap was kept; try again.`, outcome.status === 404 ? 409 : outcome.status);
			}
			sessionsDeleted++;
		}
	} else {
		for (const s of linked) stores.chatStore.setGoalTopic(s.id, null);
	}
	stores.goalStore.deleteGoal(goalId);
	return { sessionsDeleted };
}
