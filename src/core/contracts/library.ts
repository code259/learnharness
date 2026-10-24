/**
 * Library contracts (fork #15 — docs/library.md): books as REFERENCES and
 * YARDSTICKS, never the curriculum. A book is a PDF copied into the library
 * plus a map (chapters → sections → page ranges → key ideas) and a coverage
 * record (each idea judged against the learner's knowledge graph).
 *
 * The guardrail (issue #15): a book never narrows the learning. It reaches
 * a roadmap only through filed suggestions or an explicit "Study this book"
 * goal; it reaches a session only when the teacher consults it or the
 * learner starts "Learn this section"; coverage is shown, never acted on.
 */

export type BookStatus = "indexing" | "ready" | "error";

export interface BookSection {
	id: string;
	title: string;
	/** 1-indexed PDF pages, inclusive. */
	startPage: number;
	endPage: number;
	/** 3–6 key ideas (empty until the map's ideas pass reaches it). */
	ideas: string[];
}

export interface BookChapter {
	id: string;
	title: string;
	startPage: number;
	endPage: number;
	/** At least one; a chapter without sub-bookmarks is its own section. */
	sections: BookSection[];
}

/** One idea's judgement against the knowledge graph. */
export type IdeaStatus = "held" | "partly" | "not-yet";

export interface BookCoverage {
	/** The graph revision this was checked against — stale when it moves. */
	graphRevision: number;
	checkedAt: string;
	/** sectionId → one status per idea (same order as section.ideas). */
	ideas: Record<string, IdeaStatus[]>;
}

/** data/library/<id>/book.json */
export interface BookRecord {
	id: string;
	title: string;
	/** Where it came from (the original file name or the URL). */
	source: { kind: "file" | "url"; name: string };
	pageCount: number;
	addedAt: string;
	updatedAt: string;
	status: BookStatus;
	/** Human-readable progress while indexing ("Key ideas: 12 / 80 sections"). */
	progress?: string;
	error?: string;
	chapters: BookChapter[];
	coverage: BookCoverage | null;
	version?: number;
}

export const CURRENT_BOOK_VERSION = 1;

// ─── derived views ───────────────────────────────────────────────────────────

export type SectionCoverage = "covered" | "partly" | "not-yet" | "unknown";

export interface SectionView extends BookSection {
	coverage: SectionCoverage;
	ideaStatuses: IdeaStatus[] | null;
}

export interface ChapterView extends Omit<BookChapter, "sections"> {
	sections: SectionView[];
	coveredSections: number;
}

export interface BookSummary {
	id: string;
	title: string;
	status: BookStatus;
	progress?: string;
	pageCount: number;
	coveredSections: number;
	totalSections: number;
	/** Active/paused goals this book is pinned to. */
	pinnedGoals: { id: string; title: string }[];
	/** The book is being indexed or its coverage rechecked right now. */
	working: boolean;
}

export interface BookView extends BookSummary {
	source: BookRecord["source"];
	addedAt: string;
	error?: string;
	chapters: ChapterView[];
	coverageCheckedAt: string | null;
	/** Coverage is older than the graph (a recheck will run / is running). */
	coverageStale: boolean;
	/** The goal that follows this book ("Study this book"), if any. */
	studyGoalId: string | null;
}
