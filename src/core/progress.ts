/**
 * Progress folds (fork #12 — docs/exercises-progress.md): pure, browser-safe.
 * Weekly growth of the knowledge graph, recent counts, active days from
 * timestamps, and the calendar window. Days and weeks are LOCAL time (the
 * server is the learner's own machine) — an evening session counts for that
 * evening, not tomorrow's UTC date. Weeks start Monday.
 */
import type { GrowthPoint } from "./contracts/progress.ts";

export function mondayOf(d: Date): Date {
	return new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
}

/** Local YYYY-MM-DD. */
export function ymd(d: Date): string {
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** `d` shifted by whole local days (DST-safe). */
export function addDays(d: Date, days: number): Date {
	return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);
}

const DAY = 86_400_000;

/** Cumulative propositions per week, from the first week with any to now
 *  (weeks without new ones repeat the total — a flat line, never a gap). */
export function weeklyGrowth(createdAts: readonly string[], now: Date = new Date()): GrowthPoint[] {
	if (createdAts.length === 0) return [];
	const times = createdAts.map((s) => Date.parse(s)).filter((t) => !Number.isNaN(t)).sort((a, b) => a - b);
	if (times.length === 0) return [];
	const points: GrowthPoint[] = [];
	let i = 0;
	for (let week = mondayOf(new Date(times[0]!)); week.getTime() <= now.getTime(); week = addDays(week, 7)) {
		const end = addDays(week, 7).getTime();
		while (i < times.length && times[i]! < end) i++;
		points.push({ week: ymd(week), total: i });
	}
	return points;
}

export function countSince(createdAts: readonly string[], days: number, now: Date = new Date()): number {
	const cutoff = now.getTime() - days * DAY;
	return createdAts.filter((s) => Date.parse(s) >= cutoff).length;
}

/** Distinct active days (local YYYY-MM-DD) from activity timestamps (ms). */
export function activeDays(timestamps: readonly number[]): string[] {
	return [...new Set(timestamps.filter((t) => Number.isFinite(t) && t > 0).map((t) => ymd(new Date(t))))].sort();
}

/** The calendar window: the Monday `weeks - 1` weeks before this week's. */
export function calendarStart(weeks: number, now: Date = new Date()): string {
	return ymd(addDays(mondayOf(now), -(weeks - 1) * 7));
}
