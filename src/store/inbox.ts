/**
 * InboxStore — the fs JSON adapter (data/inbox.json, fork #6).
 *
 * One small list, read-modify-write (the sources.json idiom). Captures are
 * rare and tiny, so no ledger. Wired in the composition root; the inbox
 * service is the only writer.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { PATHS } from "../../config.ts";
import { emit } from "../core/events.ts";
import type { InboxStore } from "../core/ports.ts";
import type { InboxItem } from "../core/contracts.ts";

function readAll(): InboxItem[] {
	try {
		const parsed = JSON.parse(fs.readFileSync(PATHS.inbox, "utf-8")) as { items?: unknown };
		return Array.isArray(parsed.items) ? (parsed.items as InboxItem[]) : [];
	} catch {
		return [];
	}
}

/** Atomic replace (temp + rename): a torn write never loses the list. */
function writeAll(items: InboxItem[]): void {
	fs.mkdirSync(path.dirname(PATHS.inbox), { recursive: true });
	const tmp = `${PATHS.inbox}.${crypto.randomUUID()}.tmp`;
	fs.writeFileSync(tmp, JSON.stringify({ version: 1, items }, null, "\t"), "utf-8");
	fs.renameSync(tmp, PATHS.inbox);
	emit("inbox-changed", {});
}

function list(): InboxItem[] {
	return readAll().sort((a, b) => b.touchedAt.localeCompare(a.touchedAt));
}

function add(text: string): InboxItem {
	const now = new Date().toISOString();
	const item: InboxItem = {
		id: `ib_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 8)}`,
		text: text.trim(),
		createdAt: now,
		touchedAt: now,
		status: "open",
	};
	writeAll([...readAll(), item]);
	return item;
}

function get(id: string): InboxItem | null {
	return readAll().find((i) => i.id === id) ?? null;
}

function update(id: string, patch: { status?: InboxItem["status"]; chatId?: string; goalId?: string; touch?: boolean }): InboxItem {
	const items = readAll();
	const idx = items.findIndex((i) => i.id === id);
	if (idx === -1) throw new Error(`Inbox item not found: ${id}`);
	const next: InboxItem = {
		...items[idx]!,
		...(patch.status ? { status: patch.status } : {}),
		...(patch.chatId ? { chatId: patch.chatId } : {}),
		...(patch.goalId ? { goalId: patch.goalId } : {}),
		...(patch.touch ? { touchedAt: new Date().toISOString() } : {}),
	};
	items[idx] = next;
	writeAll(items);
	return next;
}

function remove(id: string): boolean {
	const items = readAll();
	const next = items.filter((i) => i.id !== id);
	if (next.length === items.length) return false;
	writeAll(next);
	return true;
}

export const inboxStore: InboxStore = { list, add, get, update, remove };
