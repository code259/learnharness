/**
 * ExerciseStore — the fs adapter (data/exercises.json, fork #11): the marks
 * learners put on exercise cards. One small list, atomic replace; the
 * progress service is the only writer.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { PATHS } from "../../config.ts";
import { emit } from "../core/events.ts";
import type { ExerciseStore } from "../core/ports.ts";
import type { ExerciseMark } from "../core/contracts.ts";

function readAll(): ExerciseMark[] {
	try {
		const parsed = JSON.parse(fs.readFileSync(PATHS.exercises, "utf-8")) as { marks?: unknown };
		return Array.isArray(parsed.marks) ? (parsed.marks as ExerciseMark[]) : [];
	} catch {
		return [];
	}
}

function writeAll(marks: ExerciseMark[]): void {
	fs.mkdirSync(path.dirname(PATHS.exercises), { recursive: true });
	const tmp = `${PATHS.exercises}.${crypto.randomUUID()}.tmp`;
	fs.writeFileSync(tmp, JSON.stringify({ version: 1, marks }, null, "\t"), "utf-8");
	fs.renameSync(tmp, PATHS.exercises);
	emit("exercises-changed", {});
}

export const exerciseStore: ExerciseStore = {
	list: () => readAll().sort((a, b) => b.markedAt.localeCompare(a.markedAt)),
	get: (callId) => readAll().find((m) => m.callId === callId) ?? null,
	mark(mark) {
		writeAll([...readAll().filter((m) => m.callId !== mark.callId), mark]);
		return mark;
	},
};
