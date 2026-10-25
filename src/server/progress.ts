/**
 * THE PROGRESS SERVICE (forks #11, #12 — docs/exercises-progress.md): the
 * sole writer of exercise marks, and the progress page's view — everything
 * derived from what the other stores already hold (the graph, goals, the
 * field map, the library, papers, exercise marks, session timestamps).
 */

import type { ExerciseMark, ExerciseStatus, ProgressView } from "../core/contracts.ts";
import { activeDays, calendarStart, countSince, weeklyGrowth } from "../core/progress.ts";
import { areaViews, fieldTotals } from "../core/fieldmap.ts";
import { getGraph } from "../core/graph.ts";
import { stores } from "./stores.ts";
import { GoalServiceError } from "./agent-engines.ts";
import { listGoalSummaries } from "./goals.ts";
import { listBookSummaries } from "./library.ts";
import { calibration } from "./papers.ts";

const CALENDAR_WEEKS = 26;

// ─── exercise marks ──────────────────────────────────────────────────────────

export function getExerciseMark(callId: string): ExerciseMark | null {
	return stores.exerciseStore.get(callId);
}

/** Mark an exercise card. The card's content comes from the session's own
 *  suggest_exercise call (looked up server-side — the client sends only
 *  the status and note). */
export function markExercise(chatId: string, callId: string, status: ExerciseStatus, note?: string): ExerciseMark {
	const chat = stores.chatStore.getChat(chatId);
	if (!chat) throw new GoalServiceError("Session not found", 404);
	type CardInput = { title?: string; url?: string; source?: string };
	let input: CardInput | null = null;
	for (const m of chat.messages) {
		const content = (m as { role?: string; content?: unknown }).role === "assistant" ? ((m as { content?: unknown }).content as Array<{ type?: string; id?: string; name?: string; arguments?: unknown }>) : [];
		const call = Array.isArray(content) ? content.find((c) => c.type === "toolCall" && c.id === callId && c.name === "suggest_exercise") : undefined;
		if (call) input = call.arguments as CardInput;
	}
	if (!input?.title || !input.url) throw new GoalServiceError("That exercise card isn't in this session", 404);
	return stores.exerciseStore.mark({
		callId,
		chatId,
		title: input.title,
		url: input.url,
		source: input.source ?? "",
		status,
		...(note?.trim() ? { note: note.trim().slice(0, 2000) } : {}),
		markedAt: new Date().toISOString(),
	});
}

// ─── the progress view ───────────────────────────────────────────────────────

/** Learner activity timestamps: their messages and answers in any session. */
function activityTimestamps(): number[] {
	const out: number[] = [];
	for (const summary of stores.chatStore.listChats()) {
		const chat = stores.chatStore.getChat(summary.id);
		for (const m of chat?.messages ?? []) {
			const role = (m as { role?: string }).role;
			if (role === "user" || role === "toolResult") out.push((m as { timestamp?: number }).timestamp ?? 0);
		}
	}
	return out;
}

export function getProgressView(now: Date = new Date()): ProgressView {
	const createdAts = getGraph(stores.graphStore).nodes.map((n) => n.createdAt);
	const map = stores.fieldMapStore.read();
	const field = map && map.areas.length > 0 ? { ...fieldTotals(areaViews(map.areas, map.coverage)), history: map.history ?? [] } : null;
	const chats = stores.chatStore.listChats() as (ReturnType<typeof stores.chatStore.listChats>[number] & { paperId?: string })[];
	const paperChats = chats.filter((c) => c.paperId);
	const marks = stores.exerciseStore.list();
	const start = calendarStart(CALENDAR_WEEKS, now);
	return {
		growth: { points: weeklyGrowth(createdAts, now), total: createdAts.length, newThisWeek: countSince(createdAts, 7, now), newThisMonth: countSince(createdAts, 30, now) },
		goals: listGoalSummaries()
			.filter((g) => g.status === "active")
			.map((g) => ({ id: g.id, title: g.title, covered: g.coveredCount, total: g.totalCount })),
		field: field ? { known: field.known, partly: field.partly, total: field.total, history: field.history } : null,
		reading: {
			papersRead: new Set(paperChats.map((c) => c.paperId)).size,
			paperSessions: paperChats.length,
			books: listBookSummaries()
				.filter((b) => b.status === "ready")
				.map((b) => ({ id: b.id, title: b.title, covered: b.coveredSections, total: b.totalSections })),
			calibration: calibration(),
		},
		practice: { done: marks.filter((m) => m.status === "done").length, struggled: marks.filter((m) => m.status === "struggled").length, recent: marks.slice(0, 8) },
		activeDays: activeDays(activityTimestamps()).filter((d) => d >= start),
		calendar: { start, weeks: CALENDAR_WEEKS },
	};
}
