/**
 * Goal derivation — pure folds from (goal record, linked sessions) to the
 * views the roadmap page and the sidebar render. Nothing here is stored:
 * topic progress, availability, and the pace estimate are recomputed on
 * every read (docs/goals-roadmaps.md; the forgiving-schedule rules in
 * docs/forgiving-schedule.md — no deadlines, no "behind", estimates in
 * ACTIVE weeks only).
 *
 * Browser-safe (no IO); the server passes records in.
 */
import type { PlanTree } from "./contracts/plan.ts";
import { derivePlanStatusesLh } from "./contracts/plan.ts";
import type {
	GoalEstimate,
	GoalRecord,
	GoalSummary,
	GoalTopicLink,
	GoalView,
	TopicSessionView,
	TopicStatus,
	TopicView,
} from "./contracts/goals.ts";
import type { LhMessage } from "./native-messages.ts";

/** The slice of a chat record the goal folds read. */
export interface LinkedSession {
	id: string;
	title: string;
	createdAt: string;
	updatedAt: string;
	messages: readonly LhMessage[];
	tree?: PlanTree;
	goalTopic?: GoalTopicLink;
}

/** The session plan's goal nodes: the sinks of the map (no outgoing edge).
 *  plan_init puts the learner's goal at the sink (prompts/teacher/10-planning.md). */
export function planSinks(tree: PlanTree): string[] {
	const hasOut = new Set(tree.edges.map((e) => e.from));
	return tree.nodes.map((n) => n.id).filter((id) => !hasOut.has(id));
}

/** Did this session reach its plan's goal? True once a teach question was
 *  tagged with a sink of the session map — the existing position signal
 *  ("this question is about this node"), applied to the final node. */
export function sessionCoveredGoal(session: Pick<LinkedSession, "messages" | "tree">): boolean {
	const tree = session.tree;
	if (!tree || tree.nodes.length === 0) return false;
	const statuses = derivePlanStatusesLh(tree, session.messages);
	const reached = new Set(statuses.visited);
	if (statuses.current) reached.add(statuses.current);
	return planSinks(tree).some((id) => reached.has(id));
}

/** Stable topological order (Kahn; ties keep the stored order). Nodes in a
 *  cycle — impossible after createTree validation — append at the end. */
export function topoOrder(tree: PlanTree): string[] {
	const indeg = new Map(tree.nodes.map((n) => [n.id, 0]));
	for (const e of tree.edges) indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
	const order: string[] = [];
	const done = new Set<string>();
	let progressed = true;
	while (progressed) {
		progressed = false;
		for (const n of tree.nodes) {
			if (done.has(n.id) || (indeg.get(n.id) ?? 0) > 0) continue;
			done.add(n.id);
			order.push(n.id);
			progressed = true;
			for (const e of tree.edges) if (e.from === n.id) indeg.set(e.to, (indeg.get(e.to) ?? 1) - 1);
		}
	}
	for (const n of tree.nodes) if (!done.has(n.id)) order.push(n.id);
	return order;
}

/** ISO-ish week key (UTC Monday-based) for the active-week count. */
function weekKey(iso: string): string {
	const d = new Date(iso);
	const day = (d.getUTCDay() + 6) % 7; // Monday = 0
	const monday = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day);
	return new Date(monday).toISOString().slice(0, 10);
}

/** How many covered topics before an estimate is shown — one data point is
 *  noise, and a confident-looking number from noise is worse than none. */
export const ESTIMATE_MIN_COVERED = 2;

/**
 * The pace estimate: covered topics per ACTIVE week (a week with any goal
 * session activity), projected over the remaining topics. Idle weeks never
 * enter the pace, so time away changes nothing (forgiving rule 7).
 */
export function goalEstimate(covered: number, total: number, sessions: readonly LinkedSession[]): GoalEstimate | null {
	const remaining = total - covered;
	if (remaining <= 0 || covered < ESTIMATE_MIN_COVERED) return null;
	const weeks = new Set<string>();
	for (const s of sessions) {
		weeks.add(weekKey(s.createdAt));
		weeks.add(weekKey(s.updatedAt));
	}
	const pace = covered / Math.max(weeks.size, 1); // topics per active week
	return { remainingTopics: remaining, activeWeeks: Math.max(1, Math.ceil(remaining / pace)) };
}

function sessionView(s: LinkedSession): TopicSessionView {
	return { id: s.id, title: s.title, updatedAt: s.updatedAt, covered: sessionCoveredGoal(s) };
}

/** The full roadmap-page view of one goal. `sessions` may include chats
 *  linked to other goals — only this goal's links are read. */
export function deriveGoalView(goal: GoalRecord, sessions: readonly LinkedSession[], working: boolean): GoalView {
	const linked = sessions
		.filter((s) => s.goalTopic?.goalId === goal.id)
		.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
	const tree = goal.roadmap ?? { nodes: [], edges: [], version: 0 };
	const known = new Set(tree.nodes.map((n) => n.id));
	const byTopic = new Map<string, TopicSessionView[]>();
	const orphanSessions: TopicSessionView[] = [];
	for (const s of linked) {
		const view = sessionView(s);
		const topicId = s.goalTopic!.topicId;
		if (!known.has(topicId)) {
			orphanSessions.push(view);
			continue;
		}
		const list = byTopic.get(topicId) ?? [];
		list.push(view);
		byTopic.set(topicId, list);
	}
	const statusOf = new Map<string, TopicStatus>();
	for (const n of tree.nodes) {
		const list = byTopic.get(n.id) ?? [];
		statusOf.set(n.id, list.some((v) => v.covered) ? "covered" : list.length > 0 ? "in-progress" : "not-started");
	}
	const prereqs = new Map<string, string[]>();
	for (const e of tree.edges) prereqs.set(e.to, [...(prereqs.get(e.to) ?? []), e.from]);
	const byId = new Map(tree.nodes.map((n) => [n.id, n]));
	const topics: TopicView[] = topoOrder(tree).map((id) => {
		const node = byId.get(id)!;
		const status = statusOf.get(id)!;
		const pre = prereqs.get(id) ?? [];
		return {
			id,
			title: node.title,
			...(node.summary ? { summary: node.summary } : {}),
			status,
			available: status !== "covered" && pre.every((p) => statusOf.get(p) === "covered"),
			prerequisites: pre,
			sessions: byTopic.get(id) ?? [],
		};
	});
	const coveredCount = topics.filter((t) => t.status === "covered").length;
	return {
		id: goal.id,
		title: goal.title,
		statement: goal.statement,
		status: goal.status,
		createdAt: goal.createdAt,
		updatedAt: goal.updatedAt,
		topics,
		edges: tree.edges,
		coveredCount,
		totalCount: topics.length,
		estimate: goalEstimate(coveredCount, topics.length, linked),
		messages: goal.messages,
		suggestions: goal.suggestions.filter((s) => s.status === "open"),
		working,
		...(goal.lastError ? { lastError: goal.lastError } : {}),
		orphanSessions,
	};
}

/** The sidebar row: counts only (the same fold, trimmed). Ordered by the
 *  caller; latest activity is the goal's own or its newest session's. */
export function deriveGoalSummary(goal: GoalRecord, sessions: readonly LinkedSession[], working: boolean): GoalSummary {
	const view = deriveGoalView(goal, sessions, working);
	const newestSession = sessions
		.filter((s) => s.goalTopic?.goalId === goal.id)
		.reduce((acc, s) => (s.updatedAt > acc ? s.updatedAt : acc), goal.updatedAt);
	return {
		id: goal.id,
		title: goal.title,
		status: goal.status,
		coveredCount: view.coveredCount,
		totalCount: view.totalCount,
		updatedAt: newestSession,
		working,
	};
}

/** Roadmap context lines for prompts (the roadmap agent, the goal-context
 *  marker): one line per topic in topo order with its derived status. */
export function roadmapStatusLines(view: Pick<GoalView, "topics">): string[] {
	return view.topics.map((t) => {
		const pre = t.prerequisites.length > 0 ? ` (after: ${t.prerequisites.join(", ")})` : "";
		const sessions = t.sessions.length > 0 ? ` — ${t.sessions.length} session${t.sessions.length === 1 ? "" : "s"}` : "";
		return `- [${t.id}] ${t.title}: ${t.status}${pre}${sessions}${t.summary ? `\n    ${t.summary}` : ""}`;
	});
}
