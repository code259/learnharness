import type { ComponentType } from "react";
import type { ArtifactPartProps } from "@/src/core";
import { DemoCard } from "@/components/artifacts/demo-card";
import { JobCard, PdfJobCard } from "@/components/artifacts/job-card";
import { VisualCard } from "@/components/artifacts/visual-card";
import { ProbeDoneCard } from "@/components/artifacts/probe-done-card";
import { ToolCallCard } from "@/components/artifacts/tool-call-card";
import { RoadmapOfferCard } from "@/components/artifacts/roadmap-offer-card";
import { ExerciseCard } from "@/components/artifacts/exercise-card";
import { ProblemCard, ConcludeCard } from "@/components/practice-cards";

/**
 * Artifact renderer registry — the extension point for tool-part UI.
 *
 * chat.tsx renders any tool part it doesn't specially handle (i.e. not
 * quiz/ask) by looking the tool name up here. Add your renderer — do NOT
 * edit chat.tsx (see docs/plan.md file-ownership rules).
 *
 * Typical shape: while the part is input-available render an activity card
 * (the chat view's jobs feed reads GET /api/jobs?chatId=…; on completion call
 * ChatActionsContext.syncFromServer()); when output-available render the
 * artifact itself from part.output.
 */
export const artifactRenderers: Record<string, ComponentType<ArtifactPartProps>> = {
	research: JobCard,
	pdf: PdfJobCard, // sources v0 — live smoke 2026-09-19 caught the gap: without this the tool-pdf dispatch part rendered nothing
	// plan_* parts render nothing inline by design: the phase seam is a
	// message-level boundary, drawn by PhaseDivider in chat.tsx (the old
	// part-level plan_init divider retired with it).
	// Artifacts (W6 fills in the components):
	demo: DemoCard,
	visual: VisualCard,
	// The probe conclusion: the assessment belongs to the learner as much as
	// to the transcript (docs/probe-teach-split.md §2). Plain v1 card.
	probe_done: ProbeDoneCard,
	// The learner-filesystem set (sources v1): one quiet expandable
	// tool-call card each — collapsed one-liner (tool name + headline
	// argument), full input/output on expand.
	read: ToolCallCard,
	ls: ToolCallCard,
	find: ToolCallCard,
	grep: ToolCallCard,
	// The practice pair (2026-10-04): the pose renders the statement ONLY
	// (the commitment lives in the call's arguments and never renders);
	// the conclusion carries the outcome + verdict + the reveal.
	problem: ProblemCard,
	conclude: ConcludeCard,
	// The prober's graph tools (wave 7): same quiet expandable card —
	// collapsed one-liner (tool name + the session id for
	// list_propositions), the tool's own compact row-per-line output
	// (name / level / date) verbatim on expand, exactly the read/ls
	// discipline (their results are pre-formatted strings too).
	list_sessions: ToolCallCard,
	list_propositions: ToolCallCard,
	// Goals (fork #4): the accepted roadmap offer links to the goal's page;
	// a filed roadmap suggestion is a quiet trace like the fs tools.
	offer_roadmap: RoadmapOfferCard,
	suggest_roadmap_change: ToolCallCard,
	// Library (fork #15): consult_book is a "pdf" job under the hood — the
	// same dispatch card; list_books is a quiet trace.
	consult_book: PdfJobCard,
	list_books: ToolCallCard,
	// Paper sessions (fork #8): quiet traces of the calibration record.
	record_prediction: ToolCallCard,
	resolve_prediction: ToolCallCard,
	// External exercises (fork #11): the suggestion is a markable card; the
	// catalog search is a quiet trace.
	suggest_exercise: ExerciseCard,
	find_exercises: ToolCallCard,
};
