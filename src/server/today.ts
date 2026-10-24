/**
 * THE TODAY + INBOX SERVICE (fork #2/#5/#6 — docs/today-inbox.md): gathers
 * the Today plan's inputs from the stores and runs the pure folds
 * (core/today.ts); owns the inbox's writes. Routes come through here.
 */

import {
	inboxArchived,
	inboxOpen,
	titleFromPrompt,
	TODAY_BUDGETS,
	type InboxItem,
	type InboxView,
	type TodayBudget,
	type TodayPlan,
} from "../core/contracts.ts";
import { fillBudget, isGap, recentPicks, todayCandidates } from "../core/today.ts";
import { sessionCoveredGoal } from "../core/goals.ts";
import { getGraph } from "../core/graph.ts";
import { stores } from "./stores.ts";
import { stampStrongSlot } from "./chats.ts";
import { GoalServiceError, getGoalView, listGoalSummaries, sendRoadmapMessage } from "./goals.ts";

export function parseBudget(raw: string | null): TodayBudget {
	const n = Number(raw);
	return (TODAY_BUDGETS as readonly number[]).includes(n) ? (n as TodayBudget) : 30;
}

/** The most recent teach session with a plan that hasn't reached its goal
 *  node — "pick up where you left off" (a plan awaiting the go-ahead counts:
 *  it's just as unfinished). */
function continueSession(): { id: string; title: string; goalTitle?: string } | null {
	const { chatStore, goalStore } = stores;
	for (const summary of chatStore.listChats()) {
		if (summary.kind !== "teach" || summary.phase === "probe") continue;
		const record = chatStore.getChat(summary.id);
		if (!record?.tree || record.tree.nodes.length === 0 || sessionCoveredGoal(record)) continue;
		const goalTitle = record.goalTopic ? goalStore.getGoal(record.goalTopic.goalId)?.title : undefined;
		return { id: record.id, title: record.title, ...(goalTitle ? { goalTitle } : {}) };
	}
	return null;
}

/** The plan for one budget, freshly derived. */
export function todayPlan(budget: TodayBudget, now: Date = new Date()): TodayPlan {
	const chats = stores.chatStore.listChats();
	const lastActivityAt = chats[0]?.updatedAt ?? null; // listChats is newest-first
	const recentGoal = listGoalSummaries().find((g) => g.status === "active") ?? null;
	const candidates = todayCandidates({
		continueSession: continueSession(),
		goal: recentGoal ? getGoalView(recentGoal.id) : null,
		picks: recentPicks(getGraph(stores.graphStore).nodes),
		inbox: inboxView(now).open,
	});
	return { budget, items: fillBudget(candidates, budget), candidates, gap: isGap(lastActivityAt, now) };
}

// ─── inbox ───────────────────────────────────────────────────────────────────

export function inboxView(now: Date = new Date()): InboxView {
	const items = stores.inboxStore.list();
	return {
		open: items.filter((i) => inboxOpen(i, now)),
		archived: items.filter((i) => inboxArchived(i, now)),
	};
}

export function captureInboxItem(text: string): InboxItem {
	const t = text.trim();
	if (!t) throw new GoalServiceError("Write something to capture", 400);
	if (t.length > 4000) throw new GoalServiceError("That's too long for the inbox (4000 characters max)", 400);
	return stores.inboxStore.add(t);
}

function mustItem(id: string): InboxItem {
	const item = stores.inboxStore.get(id);
	if (!item) throw new GoalServiceError("Inbox item not found", 404);
	return item;
}

/** archive / restore (restore touches it, so the 30-day clock restarts). */
export function setInboxArchived(id: string, archived: boolean): void {
	mustItem(id);
	stores.inboxStore.update(id, archived ? { status: "archived" } : { status: "open", touch: true });
}

/** Start a teaching session from an item → { id, prompt } for the client's
 *  /chat/<id>?prompt= contract (the same first-send path as home). */
export function startInboxSession(id: string): { id: string; prompt: string } {
	const item = mustItem(id);
	const chat = stores.chatStore.createChat(titleFromPrompt(item.text));
	stampStrongSlot(chat.id);
	stores.inboxStore.update(id, { status: "started", chatId: chat.id });
	return { id: chat.id, prompt: item.text };
}

/** Hand the item to a roadmap's conversation; the roadmap agent decides. */
export function sendInboxToRoadmap(id: string, goalId: string): void {
	const item = mustItem(id);
	sendRoadmapMessage(goalId, `Consider adding this to the roadmap: ${item.text}`);
	stores.inboxStore.update(id, { status: "sent", goalId });
}

/** Delete an item for good — archived items only (the archive is the one
 *  place deletion is offered; an open item gets archived first). */
export function deleteInboxItem(id: string): void {
	const item = mustItem(id);
	if (!inboxArchived(item)) throw new GoalServiceError("Only archived items can be deleted — archive it first", 409);
	stores.inboxStore.remove(id);
}
