/**
 * PaperStore + FeedStore — the fs adapters for the Library's Papers shelf
 * and the feed (forks #8, #9). Papers: data/library/papers/<id>/{paper.pdf,
 * paper.json}. Feed: data/library/feed.json. Same idioms as the library
 * store: id-guarded paths, atomic replace, the lazy schema stamp with the
 * newer-version read refusal. The papers service is the only writer.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { PATHS } from "../../config.ts";
import { emit } from "../core/events.ts";
import type { FeedStore, PaperStore } from "../core/ports.ts";
import { CURRENT_PAPER_VERSION, type FeedRecord, type PaperRecord } from "../core/contracts.ts";

function paperDir(id: string): string {
	if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error(`Invalid paper id: ${id}`);
	return path.join(PATHS.papers, id);
}

function atomicWrite(file: string, data: unknown): void {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	const tmp = `${file}.${crypto.randomUUID()}.tmp`;
	fs.writeFileSync(tmp, JSON.stringify(data, null, "\t"), "utf-8");
	fs.renameSync(tmp, file);
	emit("papers-changed", {});
}

function getPaper(id: string): PaperRecord | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(fs.readFileSync(path.join(paperDir(id), "paper.json"), "utf-8"));
	} catch {
		return null;
	}
	const v = (parsed as { version?: unknown }).version;
	if (typeof v === "number" && v > CURRENT_PAPER_VERSION) {
		console.error(`[paper ${id}] record stamped with schema version ${v} > ${CURRENT_PAPER_VERSION} — refusing to read it`);
		return null;
	}
	return parsed as PaperRecord;
}

function savePaper(record: PaperRecord): PaperRecord {
	const next = { ...record, updatedAt: new Date().toISOString(), version: CURRENT_PAPER_VERSION };
	atomicWrite(path.join(paperDir(record.id), "paper.json"), next);
	return next;
}

function createPaper(input: Omit<PaperRecord, "id" | "addedAt" | "updatedAt" | "predictions" | "version">): PaperRecord {
	const now = new Date().toISOString();
	return savePaper({ ...input, id: `paper_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 8)}`, addedAt: now, updatedAt: now, predictions: [] });
}

function listPapers(): PaperRecord[] {
	try {
		fs.mkdirSync(PATHS.papers, { recursive: true });
		return fs
			.readdirSync(PATHS.papers, { withFileTypes: true })
			.filter((d) => d.isDirectory())
			.map((d) => getPaper(d.name))
			.filter((r): r is PaperRecord => r !== null)
			.sort((a, b) => b.addedAt.localeCompare(a.addedAt));
	} catch {
		return [];
	}
}

function pdfPath(id: string): string {
	return path.join(paperDir(id), "paper.pdf");
}

function deletePaper(id: string): boolean {
	const dir = paperDir(id);
	if (!fs.existsSync(dir)) return false;
	fs.rmSync(dir, { recursive: true, force: true });
	emit("papers-changed", {});
	return true;
}

export const paperStore: PaperStore = { createPaper, getPaper, listPapers, savePaper, pdfPath, deletePaper };

/** Seen URLs kept (enough for months of daily scans). */
const SEEN_CAP = 20_000;

export const feedStore: FeedStore = {
	read(): FeedRecord {
		try {
			const parsed = JSON.parse(fs.readFileSync(PATHS.feed, "utf-8")) as FeedRecord;
			return { ...parsed, items: parsed.items ?? [], seen: parsed.seen ?? [] };
		} catch {
			return { items: [], seen: [] };
		}
	},
	write(record: FeedRecord): void {
		atomicWrite(PATHS.feed, { ...record, version: 1, seen: record.seen.slice(-SEEN_CAP) });
	},
};
