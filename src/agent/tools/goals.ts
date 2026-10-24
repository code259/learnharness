import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { serverExecute } from "../tool-execute.ts";

/**
 * The session-side goal tools (goals, fork #4 — docs/goals-roadmaps.md).
 * SERVER-SIDE, fire-and-forget: the goals service (injected — the agent
 * layer never imports the server) does the writing.
 *
 *   offer_roadmap           PROBER, unlinked sessions only. The learner has
 *                           ACCEPTED a long-term roadmap (asked via
 *                           ask_user_question first): creates the goal, links
 *                           this session to its first topic, and fires the
 *                           background roadmap draft. The prober keeps
 *                           probing — now for the first topic only.
 *   suggest_roadmap_change  PROBER + TEACHER, linked sessions only. Files a
 *                           suggestion on the goal's roadmap page; nothing
 *                           changes until the learner applies it there.
 */

export interface OfferRoadmapInput {
	title: string;
	goal: string;
	firstTopic: string;
	firstTopicSummary: string;
	notes: string;
}

/** The offer_roadmap result's UI payload (components/artifacts). */
export interface RoadmapOfferDetails {
	goalId: string;
	title: string;
	firstTopic: string;
}

export interface OfferRoadmapContext {
	/** Create the goal, link this chat, fire the draft. Throws on refusal. */
	startRoadmap: (input: OfferRoadmapInput) => { goalId: string; topicId: string };
}

const offerRoadmapInput = Type.Object({
	title: Type.String({ minLength: 1, description: "A short name for the goal (a few words) — its folder name in the sidebar." }),
	goal: Type.String({ minLength: 1, description: "The long-term goal, as concretely as the learner stated it." }),
	firstTopic: Type.String({ minLength: 1, description: "Short title of THIS session's topic — the first stretch, session-sized." }),
	firstTopicSummary: Type.String({ minLength: 1, description: "1–2 sentences: the understanding this session should reach." }),
	notes: Type.String({
		description:
			"What the probe has established so far about what he already holds and lacks, relevant to the whole goal — the roadmap drafter starts from it.",
	}),
});

export function offerRoadmapTool(ctx: OfferRoadmapContext): Record<string, AgentTool<any>> {
	return {
		offer_roadmap: {
			name: "offer_roadmap",
			label: "offer_roadmap",
			description:
				"Create a long-term roadmap for a goal too big for one session — ONLY after the learner accepted the offer (ask_user_question first). " +
				"Creates the goal, makes this session its first topic, and drafts the full roadmap in the background (the learner sees it on the goal's page). " +
				"Resolves immediately: continue probing, now scoped to the first topic only. Call at most once.",
			parameters: offerRoadmapInput,
			execute: serverExecute("offer_roadmap", offerRoadmapInput, async (input) => {
				const { goalId, topicId } = ctx.startRoadmap(input);
				// Two audiences (the plan_init precedent): the model reads `text`;
				// `details` is the transcript card's payload (the goal link).
				return {
					text:
						`Roadmap created; the full map is being drafted in the background. This session is now its first topic ` +
						`("${input.firstTopic}", id ${topicId}). Continue the probe for this topic only — do not mention waiting.`,
					details: { goalId, title: input.title, firstTopic: input.firstTopic } satisfies RoadmapOfferDetails,
				};
			}),
		},
	};
}

export interface SuggestRoadmapContext {
	/** File the suggestion on this session's goal. */
	addSuggestion: (text: string) => void;
}

const suggestInput = Type.Object({
	suggestion: Type.String({
		minLength: 1,
		description:
			"The proposed change and the evidence for it, e.g. 'He already holds backprop through attention — the topic can be dropped' or 'Missing foundation: eigendecomposition before PCA'.",
	}),
});

export function suggestRoadmapTool(ctx: SuggestRoadmapContext): Record<string, AgentTool<any>> {
	return {
		suggest_roadmap_change: {
			name: "suggest_roadmap_change",
			label: "suggest_roadmap_change",
			description:
				"File a suggested change to the learner's long-term roadmap (this session is one of its topics) — when the session reveals he already holds a later topic, or lacks a foundation the roadmap doesn't have. " +
				"The suggestion waits on the roadmap page; the learner applies or dismisses it. Resolves immediately; continue your turn.",
			parameters: suggestInput,
			execute: serverExecute("suggest_roadmap_change", suggestInput, async ({ suggestion }) => {
				ctx.addSuggestion(suggestion);
				return "Suggestion filed on the roadmap page. Continue the session.";
			}),
		},
	};
}
