/**
 * The AI safety field map (fork #10 — docs/field-map.md): the landscape of
 * technical AI safety research agendas, seeded from the Shallow Review of
 * Technical AI Safety 2025 (downloaded at build time, never committed;
 * entries rewritten in the app's own words), refined by an agent against
 * newer sources, and overlaid with the learner's knowledge-graph coverage.
 *
 * A mirror, never a driver: nothing here sets a roadmap or a session —
 * the learner acts from it (learn / add to a roadmap / make a goal).
 */
import type { IdeaStatus, SectionCoverage } from "./library.ts";

export interface FieldAgenda {
	id: string;
	title: string;
	/** What it is, in plain words. */
	summary: string;
	/** Why it would help make AI safe. */
	theoryOfChange: string;
	/** 4–8 short self-contained statements one must understand — what
	 *  coverage is measured against. */
	concepts: string[];
	status: "active" | "dormant";
	/** The seed agenda it came from (the review's name), if any. */
	seedName?: string;
}

export interface FieldArea {
	id: string;
	title: string;
	summary: string;
	agendas: FieldAgenda[];
}

export type FieldProposalKind = "add" | "edit" | "dormant" | "remove";

/** One change the update agent proposes (accepted/rejected by the learner;
 *  applied directly only on the first build's refinement). */
export interface FieldProposal {
	id: string;
	kind: FieldProposalKind;
	/** The area (by title — new titles create the area on add). */
	areaTitle: string;
	/** The agenda to change (edit/dormant/remove). */
	agendaId?: string;
	/** The new or revised agenda (add/edit). */
	agenda?: { title: string; summary: string; theoryOfChange: string; concepts: string[] };
	reason: string;
	/** Supporting URLs. */
	sources: string[];
	status: "open" | "accepted" | "rejected";
	createdAt: string;
}

export interface FieldChange {
	at: string;
	summary: string;
}

export interface FieldCoverage {
	graphRevision: number;
	checkedAt: string;
	/** agendaId → one status per concept. */
	concepts: Record<string, IdeaStatus[]>;
}

export type FieldMapStatus = "empty" | "building" | "ready" | "error";

/** data/fieldmap/map.json */
export interface FieldMapRecord {
	version?: number;
	status: FieldMapStatus;
	progress?: string;
	error?: string;
	/** When the map was first built / last changed by an update. */
	builtAt?: string;
	updatedAt?: string;
	/** What the map was built and refined from. */
	sources: { title: string; url: string }[];
	areas: FieldArea[];
	coverage: FieldCoverage | null;
	proposals: FieldProposal[];
	/** The change log (refinements, accepted proposals). */
	changes: FieldChange[];
}

export const CURRENT_FIELDMAP_VERSION = 1;

// ─── views ───────────────────────────────────────────────────────────────────

export interface ConceptCounts {
	known: number;
	partly: number;
	notYet: number;
	total: number;
}

export interface AgendaView extends FieldAgenda, ConceptCounts {
	coverage: SectionCoverage;
	conceptStatuses: IdeaStatus[] | null;
}

export interface AreaView extends Omit<FieldArea, "agendas">, ConceptCounts {
	agendas: AgendaView[];
}

/** One "Where you stand" bar. */
export interface StandingRow extends ConceptCounts {
	id: string;
	title: string;
}

export interface FieldMapView {
	status: FieldMapStatus;
	progress?: string;
	error?: string;
	builtAt: string | null;
	updatedAt: string | null;
	sources: FieldMapRecord["sources"];
	areas: AreaView[];
	/** Open proposals only. */
	proposals: FieldProposal[];
	/** Most recent first. */
	changes: FieldChange[];
	working: boolean;
	coverageCheckedAt: string | null;
	coverageStale: boolean;
}
