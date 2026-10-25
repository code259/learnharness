/**
 * Exercises + progress contracts (forks #11, #12 — docs/exercises-progress.md).
 *
 * Exercises are suggested INSIDE teaching chats (suggest_exercise → a card);
 * the learner marks the card Done / Struggled with an optional note — the
 * marks live in data/exercises.json, keyed by the suggestion's tool call.
 *
 * The progress page is a mirror (docs/forgiving-schedule.md): growth,
 * goals & field, reading & taste, practice & activity. No streaks, no
 * "behind"; inactive days are simply blank.
 */
import type { CalibrationBand } from "./papers.ts";

export type ExerciseStatus = "done" | "struggled";

export interface ExerciseMark {
	/** The suggest_exercise tool call this card came from. */
	callId: string;
	chatId: string;
	title: string;
	url: string;
	source: string;
	status: ExerciseStatus;
	note?: string;
	markedAt: string;
}

/** suggest_exercise's input = the card's content. */
export interface ExerciseSuggestion {
	title: string;
	url: string;
	source: string;
	why: string;
	catalogId?: string;
}

export interface GrowthPoint {
	/** Monday of the week, YYYY-MM-DD. */
	week: string;
	/** Cumulative propositions by the end of that week. */
	total: number;
}

export interface FieldSnapshot {
	at: string;
	known: number;
	partly: number;
	total: number;
}

export interface ProgressView {
	growth: { points: GrowthPoint[]; total: number; newThisWeek: number; newThisMonth: number };
	goals: { id: string; title: string; covered: number; total: number }[];
	field: { known: number; partly: number; total: number; history: FieldSnapshot[] } | null;
	reading: {
		papersRead: number;
		paperSessions: number;
		books: { id: string; title: string; covered: number; total: number }[];
		calibration: { bands: CalibrationBand[]; open: number };
	};
	practice: { done: number; struggled: number; recent: ExerciseMark[] };
	/** Active days (YYYY-MM-DD) within the calendar window. */
	activeDays: string[];
	/** The calendar window's first Monday (YYYY-MM-DD) and week count. */
	calendar: { start: string; weeks: number };
}
