/**
 * GoalStore — the fs JSON adapter (one file per goal in data/goals/).
 *
 * Implements core/ports.ts GoalStore; shapes live in core/contracts/goals.ts.
 * Same idioms as the chat store: sync fs, id-guarded filenames, tab-indented
 * JSON, a lazy schema stamp with the newer-version read refusal. Wired in the
 * composition root (src/server/stores.ts); the goals service is the only
 * caller that writes.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { PATHS } from "../../config.ts";
import { emit } from "../core/events.ts";
import type { GoalStore } from "../core/ports.ts";
import {
	CURRENT_GOAL_VERSION,
	type GoalMessage,
	type GoalRecord,
	type GoalStatus,
	type PlanTree,
	type RoadmapSuggestion,
	type SuggestionStatus,
} from "../core/contracts.ts";

function goalFile(id: string): string {
	if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error(`Invalid goal id: ${id}`);
	return path.join(PATHS.goals, `${id}.json`);
}

function mint(prefix: string): string {
	return `${prefix}_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 8)}`;
}

/** THE WRITE CHOKE POINT: every persist stamps the current version and
 *  announces the change (goal mutations are rare — no silence law needed). */
function writeGoal(record: GoalRecord): void {
	fs.mkdirSync(PATHS.goals, { recursive: true });
	fs.writeFileSync(goalFile(record.id), JSON.stringify({ ...record, version: CURRENT_GOAL_VERSION }, null, "\t"), "utf-8");
	emit("goals-changed", {});
}

function getGoal(id: string): GoalRecord | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(fs.readFileSync(goalFile(id), "utf-8"));
	} catch {
		return null;
	}
	const v = (parsed as { version?: unknown }).version;
	if (typeof v === "number" && v > CURRENT_GOAL_VERSION) {
		console.error(`[goal ${id}] record stamped with schema version ${v} > ${CURRENT_GOAL_VERSION} — refusing to read it`);
		return null;
	}
	return parsed as GoalRecord;
}

function mustGet(id: string): GoalRecord {
	const record = getGoal(id);
	if (!record) throw new Error(`Goal not found: ${id}`);
	return record;
}

/** Read-modify-write with the activity stamp. */
function mutate(id: string, change: (record: GoalRecord) => void): GoalRecord {
	const record = mustGet(id);
	change(record);
	record.updatedAt = new Date().toISOString();
	writeGoal(record);
	return record;
}

function createGoal(input: { title: string; statement: string }): GoalRecord {
	const now = new Date().toISOString();
	const record: GoalRecord = {
		id: mint("goal"),
		title: input.title.trim() || "Untitled goal",
		statement: input.statement.trim() || input.title.trim(),
		createdAt: now,
		updatedAt: now,
		status: "active",
		roadmap: null,
		messages: [],
		suggestions: [],
	};
	writeGoal(record);
	return { ...record, version: CURRENT_GOAL_VERSION };
}

function listGoals(): GoalRecord[] {
	try {
		fs.mkdirSync(PATHS.goals, { recursive: true });
		return fs
			.readdirSync(PATHS.goals)
			.filter((f) => f.endsWith(".json"))
			.map((f) => getGoal(f.slice(0, -5)))
			.filter((r): r is GoalRecord => r !== null)
			.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
	} catch {
		return [];
	}
}

function saveRoadmap(id: string, roadmap: PlanTree): GoalRecord {
	return mutate(id, (r) => {
		r.roadmap = roadmap;
	});
}

function appendMessage(id: string, message: Omit<GoalMessage, "id" | "createdAt">): GoalRecord {
	return mutate(id, (r) => {
		r.messages = [...r.messages, { id: mint("gm"), createdAt: new Date().toISOString(), role: message.role, text: message.text }];
	});
}

function update(id: string, patch: { title?: string; statement?: string; status?: GoalStatus; lastError?: string | null }): GoalRecord {
	return mutate(id, (r) => {
		if (patch.title !== undefined && patch.title.trim()) r.title = patch.title.trim();
		if (patch.statement !== undefined && patch.statement.trim()) r.statement = patch.statement.trim();
		if (patch.status !== undefined) r.status = patch.status;
		if (patch.lastError === null) delete r.lastError;
		else if (patch.lastError !== undefined) r.lastError = patch.lastError;
	});
}

function addSuggestion(id: string, input: { chatId: string; text: string }): RoadmapSuggestion {
	const suggestion: RoadmapSuggestion = {
		id: mint("sg"),
		chatId: input.chatId,
		text: input.text.trim(),
		createdAt: new Date().toISOString(),
		status: "open",
	};
	mutate(id, (r) => {
		r.suggestions = [...r.suggestions, suggestion];
	});
	return suggestion;
}

function setSuggestionStatus(id: string, suggestionId: string, status: SuggestionStatus): GoalRecord {
	return mutate(id, (r) => {
		r.suggestions = r.suggestions.map((s) => (s.id === suggestionId ? { ...s, status } : s));
	});
}

function deleteGoal(id: string): boolean {
	try {
		fs.unlinkSync(goalFile(id));
		emit("goals-changed", {});
		return true;
	} catch {
		return false;
	}
}

export const goalStore: GoalStore = {
	createGoal,
	getGoal,
	listGoals,
	saveRoadmap,
	appendMessage,
	update,
	addSuggestion,
	setSuggestionStatus,
	deleteGoal,
};
