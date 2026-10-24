/**
 * Goal + roadmap contracts — the long-lived layer ABOVE sessions
 *
 * Part of the domain-split contracts (src/core/contracts/). Design record:
 * docs/goals-roadmaps.md (fork issue #4, 2026-10-24). Pure types + tiny
 * pure helpers; browser-safe.
 *
 * A goal is a months-long learning target ("do research on data-centric
 * alignment"). Its ROADMAP is a DAG of TOPICS — each topic is one session's
 * goal, roughly one to a few teach sessions' worth. The roadmap REUSES the
 * PlanTree shape (nodes = topics, `-->` = prerequisite) and its validation
 * (core/plan-tree.ts createTree): one DAG substrate for both scales.
 *
 * What the roadmap is NOT: the session plan. The session plan (plan_init)
 * maps propositions inside one lesson; the roadmap maps lessons. Fine-grained
 * measurement stays the prober's job inside each topic's session.
 *
 * Progress is DERIVED, never stored (the architecture law, and the forgiving
 * schedule — docs/forgiving-schedule.md): a topic's status folds from the
 * sessions linked to it (ChatRecord.goalTopic) at read time.
 */
import type { PlanEdge, PlanTree } from "./plan.ts";

/** Active goals feed future surfaces (Today, #2); paused and archived goals
 *  keep their sessions grouped but drop out of "what's next". */
export type GoalStatus = "active" | "paused" | "archived";

export const GOAL_STATUSES: readonly GoalStatus[] = ["active", "paused", "archived"];

/** The link a session carries to the roadmap topic it was started from (or
 *  that the prober's roadmap offer pinned it to). Stored on the chat record
 *  — the session store stays the sole writer of sessions. */
export interface GoalTopicLink {
	goalId: string;
	topicId: string;
}

/** One turn of the roadmap-page conversation (the roadmap agent's chat). */
export interface GoalMessage {
	id: string;
	role: "user" | "assistant";
	text: string;
	createdAt: string;
}

export type SuggestionStatus = "open" | "applied" | "dismissed";

/** A roadmap change proposed from inside a linked session ("he already holds
 *  topic X", "a foundation is missing"). Nothing auto-changes: the learner
 *  applies (the roadmap agent revises) or dismisses it on the roadmap page. */
export interface RoadmapSuggestion {
	id: string;
	/** The session it came from ("" for a book comparison). */
	chatId: string;
	/** The pinned book a "Compare with my roadmap" suggestion came from. */
	bookId?: string;
	text: string;
	createdAt: string;
	status: SuggestionStatus;
}

/** One persisted goal: data/goals/<id>.json. */
export interface GoalRecord {
	id: string;
	/** Short name for the sidebar folder and page header. */
	title: string;
	/** The goal in full, as concretely as it was stated. */
	statement: string;
	createdAt: string;
	updatedAt: string;
	status: GoalStatus;
	/** The topic DAG (PlanTree shape: nodes = topics with title + summary).
	 *  null while the first draft is still being written. */
	roadmap: PlanTree | null;
	/** The roadmap-page conversation (also carries the drafter's notes). */
	messages: GoalMessage[];
	suggestions: RoadmapSuggestion[];
	/** The last roadmap-agent failure, shown on the page until the next
	 *  successful run clears it. */
	lastError?: string;
	/** Library books pinned to this goal (fork #15): PREFERRED when a
	 *  session consults a book, measured against on "Compare with my
	 *  roadmap" — never a source the roadmap is drafted from. */
	bookIds?: string[];
	/** Set only by "Study this book": the one kind of goal whose roadmap
	 *  follows a book's structure (the opt-in book-following mode). */
	followsBookId?: string;
	/** Schema stamp (lazy v1, the chat-record convention). */
	version?: number;
}

export const CURRENT_GOAL_VERSION = 1;

// ─── derived views (core/goals.ts folds these) ──────────────────────────────

/** A topic's progress, derived from its linked sessions:
 *  covered     — a linked session reached its plan's goal node (a teach
 *                question tagged with a sink of the session map)
 *  in-progress — a linked session exists, none has covered it yet
 *  not-started — no linked session */
export type TopicStatus = "covered" | "in-progress" | "not-started";

export interface TopicSessionView {
	id: string;
	title: string;
	updatedAt: string;
	covered: boolean;
}

export interface TopicView {
	id: string;
	title: string;
	summary?: string;
	status: TopicStatus;
	/** Not covered, and every prerequisite is covered — startable "next". */
	available: boolean;
	prerequisites: string[];
	sessions: TopicSessionView[];
}

/** The pace-based finish estimate (no deadlines, ever): counted in ACTIVE
 *  weeks — weeks with any activity on the goal — so time away never makes
 *  the goal look "behind". null until there is enough history. */
export interface GoalEstimate {
	remainingTopics: number;
	activeWeeks: number;
}

export interface GoalView {
	id: string;
	title: string;
	statement: string;
	status: GoalStatus;
	createdAt: string;
	updatedAt: string;
	/** Topics in a stable topological order (prerequisites first). */
	topics: TopicView[];
	edges: PlanEdge[];
	coveredCount: number;
	totalCount: number;
	estimate: GoalEstimate | null;
	messages: GoalMessage[];
	/** Open suggestions only (applied/dismissed ones are history). */
	suggestions: RoadmapSuggestion[];
	/** The roadmap agent is drafting/revising right now. */
	working: boolean;
	lastError?: string;
	/** Sessions linked to a topic id the current roadmap no longer has. */
	orphanSessions: TopicSessionView[];
	bookIds: string[];
	followsBookId: string | null;
}

/** The sidebar's compact goal row. */
export interface GoalSummary {
	id: string;
	title: string;
	status: GoalStatus;
	coveredCount: number;
	totalCount: number;
	updatedAt: string;
	working: boolean;
}

/** Slug a free title into a topic id (the plan slug rule: lowercase words
 *  joined by hyphens). Pure; never empty. */
export function topicSlug(title: string): string {
	const slug = title
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 48)
		.replace(/-+$/g, "");
	return slug || "topic";
}
