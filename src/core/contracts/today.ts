/**
 * Today + inbox contracts (fork #2, #5, #6 — docs/today-inbox.md).
 *
 * The inbox holds things captured on the fly (the ⌥⌘L capture box, the
 * Today panel's field). The Today plan is a pure, freshly derived list of
 * what to do now, filled into a time budget — never stored, never overdue
 * (docs/forgiving-schedule.md).
 */
import type { GraphContextPick } from "../native-messages.ts";

// ─── inbox ───────────────────────────────────────────────────────────────────

/** open — waiting; started — became a session; sent — handed to a roadmap's
 *  conversation; archived — put away by hand. Auto-archive is DERIVED (an
 *  open item untouched for INBOX_AUTO_ARCHIVE_DAYS reads as archived). */
export type InboxStatus = "open" | "started" | "sent" | "archived";

export interface InboxItem {
	id: string;
	text: string;
	createdAt: string;
	/** Last time the learner touched it (capture or restore) — the age the
	 *  auto-archive measures. */
	touchedAt: string;
	status: InboxStatus;
	/** The session it started (status "started"). */
	chatId?: string;
	/** The goal it was sent to (status "sent"). */
	goalId?: string;
}

export const INBOX_AUTO_ARCHIVE_DAYS = 30;
const DAY_MS = 86_400_000;

/** Is the item in the archive view right now (by hand, or aged out)? */
export function inboxArchived(item: Pick<InboxItem, "status" | "touchedAt">, now: Date = new Date()): boolean {
	if (item.status === "archived") return true;
	return item.status === "open" && now.getTime() - new Date(item.touchedAt).getTime() >= INBOX_AUTO_ARCHIVE_DAYS * DAY_MS;
}

/** Is the item waiting in the inbox (open and not aged out)? */
export function inboxOpen(item: Pick<InboxItem, "status" | "touchedAt">, now: Date = new Date()): boolean {
	return item.status === "open" && !inboxArchived(item, now);
}

export interface InboxView {
	/** Open items, newest first. */
	open: InboxItem[];
	/** Archived (by hand or aged out), newest first. */
	archived: InboxItem[];
}

// ─── Today ───────────────────────────────────────────────────────────────────

/** The time-budget choices (minutes). */
export const TODAY_BUDGETS = [15, 30, 60, 120] as const;
export type TodayBudget = (typeof TODAY_BUDGETS)[number];

/** Fixed per-item estimates (minutes). */
export const TODAY_ESTIMATES = { continue: 25, topic: 45, practice: 15, inbox: 20 } as const;

/** Days away that count as a gap: the first plan back starts at the
 *  smallest budget (forgiving rule 6). */
export const TODAY_GAP_DAYS = 3;

export type TodayItem =
	| { kind: "continue"; minutes: number; chatId: string; title: string; goalTitle?: string }
	| {
			kind: "topic";
			minutes: number;
			goalId: string;
			goalTitle: string;
			topicId: string;
			topicTitle: string;
			summary?: string;
	  }
	| { kind: "practice"; minutes: number; picks: GraphContextPick[] }
	| { kind: "inbox"; minutes: number; itemId: string; text: string };

export interface TodayPlan {
	budget: TodayBudget;
	items: TodayItem[];
	/** Every candidate before the budget cut (the panel can say "more fits
	 *  in a bigger budget" without a refetch). */
	candidates: TodayItem[];
	/** Last activity was TODAY_GAP_DAYS+ days ago — the client starts at the
	 *  smallest budget instead of the remembered one. */
	gap: boolean;
}
