/**
 * LibraryStore — the fs adapter (data/library/<bookId>/, fork #15).
 *
 * One directory per book: book.pdf (the copy — moving or deleting the
 * original never breaks the book) + book.json (map, coverage, status).
 * Same idioms as the goal store: id-guarded paths, tab-indented JSON, the
 * lazy schema stamp with the newer-version read refusal.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { PATHS } from "../../config.ts";
import { emit } from "../core/events.ts";
import type { LibraryStore } from "../core/ports.ts";
import { CURRENT_BOOK_VERSION, type BookRecord } from "../core/contracts.ts";

function bookDir(id: string): string {
	if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error(`Invalid book id: ${id}`);
	return path.join(PATHS.library, id);
}

function writeBook(record: BookRecord): void {
	fs.mkdirSync(bookDir(record.id), { recursive: true });
	const file = path.join(bookDir(record.id), "book.json");
	const tmp = `${file}.${crypto.randomUUID()}.tmp`;
	fs.writeFileSync(tmp, JSON.stringify({ ...record, version: CURRENT_BOOK_VERSION }, null, "\t"), "utf-8");
	fs.renameSync(tmp, file);
	emit("library-changed", {});
}

function getBook(id: string): BookRecord | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(fs.readFileSync(path.join(bookDir(id), "book.json"), "utf-8"));
	} catch {
		return null;
	}
	const v = (parsed as { version?: unknown }).version;
	if (typeof v === "number" && v > CURRENT_BOOK_VERSION) {
		console.error(`[book ${id}] record stamped with schema version ${v} > ${CURRENT_BOOK_VERSION} — refusing to read it`);
		return null;
	}
	return parsed as BookRecord;
}

function createBook(input: { title: string; source: BookRecord["source"]; pageCount: number }): BookRecord {
	const now = new Date().toISOString();
	const record: BookRecord = {
		id: `book_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 8)}`,
		title: input.title.trim() || "Untitled book",
		source: input.source,
		pageCount: input.pageCount,
		addedAt: now,
		updatedAt: now,
		status: "indexing",
		progress: "Queued",
		chapters: [],
		coverage: null,
	};
	writeBook(record);
	return { ...record, version: CURRENT_BOOK_VERSION };
}

function listBooks(): BookRecord[] {
	try {
		fs.mkdirSync(PATHS.library, { recursive: true });
		return fs
			.readdirSync(PATHS.library, { withFileTypes: true })
			.filter((d) => d.isDirectory())
			.map((d) => getBook(d.name))
			.filter((r): r is BookRecord => r !== null)
			.sort((a, b) => b.addedAt.localeCompare(a.addedAt));
	} catch {
		return [];
	}
}

function saveBook(record: BookRecord): BookRecord {
	const next = { ...record, updatedAt: new Date().toISOString() };
	writeBook(next);
	return next;
}

function pdfPath(id: string): string {
	return path.join(bookDir(id), "book.pdf");
}

function deleteBook(id: string): boolean {
	const dir = bookDir(id);
	if (!fs.existsSync(dir)) return false;
	fs.rmSync(dir, { recursive: true, force: true });
	emit("library-changed", {});
	return true;
}

export const libraryStore: LibraryStore = { createBook, getBook, listBooks, saveBook, pdfPath, deleteBook };
