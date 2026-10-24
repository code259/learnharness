/**
 * The Today plan — pure folds (fork #2/#5, docs/today-inbox.md). The server
 * gathers the inputs; everything here is deterministic over them, so the
 * plan is recomputed on every open and nothing is ever carried over or
 * overdue (docs/forgiving-schedule.md).
 *
 * Priority (owner, 2026-10-24): continue → next roadmap topic → practice →
 * inbox. Items are added in that order while they fit the budget; the
 * first item always shows, even when it alone exceeds it.
 */
import type { GraphNode } from "./contracts/graph.ts";
import type { GraphContextPick } from "./native-messages.ts";
import {
	TODAY_ESTIMATES,
	TODAY_GAP_DAYS,
	type InboxItem,
	type TodayItem,
} from "./contracts/today.ts";
import type { GoalView } from "./contracts/goals.ts";

const DAY_MS = 86_400_000;

/** Practice draws on propositions born on the learner's most recent ACTIVE
 *  days (calendar gaps never shrink the pool — forgiving). */
export const PRACTICE_ACTIVE_DAYS = 7;
export const PRACTICE_MAX_PICKS = 8;

/** Up to `max` propositions created on the `days` most recent distinct days
 *  that produced any, newest first. */
export function recentPicks(
	nodes: readonly Pick<GraphNode, "id" | "name" | "statement" | "createdAt">[],
	days = PRACTICE_ACTIVE_DAYS,
	max = PRACTICE_MAX_PICKS,
): GraphContextPick[] {
	const sorted = [...nodes].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
	const activeDays = [...new Set(sorted.map((n) => n.createdAt.slice(0, 10)))].slice(0, days);
	const allowed = new Set(activeDays);
	return sorted
		.filter((n) => allowed.has(n.createdAt.slice(0, 10)))
		.slice(0, max)
		.map((n) => ({ id: n.id, name: n.name, statement: n.statement }));
}

/** Was the last activity TODAY_GAP_DAYS or more days ago? No history is no
 *  gap (a first run isn't a return). */
export function isGap(lastActivityAt: string | null, now: Date = new Date()): boolean {
	if (!lastActivityAt) return false;
	return now.getTime() - new Date(lastActivityAt).getTime() >= TODAY_GAP_DAYS * DAY_MS;
}

/** The roadmap item: the most recent active goal's next topic, skipping the
 *  topic the "continue" item already covers. Prefers a not-started available
 *  topic only when the in-progress one is that same continued session. */
export function topicCandidate(
	goal: Pick<GoalView, "id" | "title" | "topics"> | null,
	continuedChatId: string | null,
): Extract<TodayItem, { kind: "topic" }> | null {
	if (!goal) return null;
	const available = goal.topics.filter((t) => t.available);
	const pick =
		available.find((t) => t.status === "in-progress" && !t.sessions.some((s) => s.id === continuedChatId)) ??
		available.find((t) => t.status === "not-started") ??
		null;
	if (!pick) return null;
	return {
		kind: "topic",
		minutes: TODAY_ESTIMATES.topic,
		goalId: goal.id,
		goalTitle: goal.title,
		topicId: pick.id,
		topicTitle: pick.title,
		...(pick.summary ? { summary: pick.summary } : {}),
	};
}

export interface TodayInputs {
	/** The most recent teach session that has a plan and hasn't reached its
	 *  goal node (the server finds it). */
	continueSession: { id: string; title: string; goalTitle?: string } | null;
	/** The most recently active goal's view (active goals only). */
	goal: Pick<GoalView, "id" | "title" | "topics"> | null;
	picks: GraphContextPick[];
	/** Open inbox items, newest first. */
	inbox: readonly InboxItem[];
}

/** Every candidate in priority order. */
export function todayCandidates(inputs: TodayInputs): TodayItem[] {
	const items: TodayItem[] = [];
	if (inputs.continueSession) {
		items.push({
			kind: "continue",
			minutes: TODAY_ESTIMATES.continue,
			chatId: inputs.continueSession.id,
			title: inputs.continueSession.title,
			...(inputs.continueSession.goalTitle ? { goalTitle: inputs.continueSession.goalTitle } : {}),
		});
	}
	const topic = topicCandidate(inputs.goal, inputs.continueSession?.id ?? null);
	if (topic) items.push(topic);
	if (inputs.picks.length > 0) items.push({ kind: "practice", minutes: TODAY_ESTIMATES.practice, picks: inputs.picks });
	const newest = inputs.inbox[0];
	if (newest) items.push({ kind: "inbox", minutes: TODAY_ESTIMATES.inbox, itemId: newest.id, text: newest.text });
	return items;
}

/** Fill the budget in priority order: add each item that still fits; the
 *  first item always shows. Later smaller items may fill a gap a bigger one
 *  left (a 30-minute budget: continue 25 — topic 45 doesn't fit — practice
 *  15 doesn't either; inbox 20 doesn't — just continue). */
export function fillBudget(candidates: readonly TodayItem[], budget: number): TodayItem[] {
	const out: TodayItem[] = [];
	let used = 0;
	for (const item of candidates) {
		if (out.length === 0 || used + item.minutes <= budget) {
			out.push(item);
			used += item.minutes;
		}
	}
	return out;
}
