/**
 * FieldMapStore — the fs adapter (data/fieldmap/map.json, fork #10). One
 * record, atomic replace (temp + rename), the lazy schema stamp with the
 * newer-version read refusal. The field-map service is the only writer.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { PATHS } from "../../config.ts";
import { emit } from "../core/events.ts";
import type { FieldMapStore } from "../core/ports.ts";
import { CURRENT_FIELDMAP_VERSION, type FieldMapRecord } from "../core/contracts.ts";

function read(): FieldMapRecord | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(fs.readFileSync(PATHS.fieldmap, "utf-8"));
	} catch {
		return null;
	}
	const v = (parsed as { version?: unknown }).version;
	if (typeof v === "number" && v > CURRENT_FIELDMAP_VERSION) {
		console.error(`[fieldmap] record stamped with schema version ${v} > ${CURRENT_FIELDMAP_VERSION} — refusing to read it`);
		return null;
	}
	return parsed as FieldMapRecord;
}

function write(record: FieldMapRecord): void {
	fs.mkdirSync(path.dirname(PATHS.fieldmap), { recursive: true });
	const tmp = `${PATHS.fieldmap}.${crypto.randomUUID()}.tmp`;
	fs.writeFileSync(tmp, JSON.stringify({ ...record, version: CURRENT_FIELDMAP_VERSION }, null, "\t"), "utf-8");
	fs.renameSync(tmp, PATHS.fieldmap);
	emit("fieldmap-changed", {});
}

export const fieldMapStore: FieldMapStore = { read, write };
