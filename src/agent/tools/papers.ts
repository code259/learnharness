import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { serverExecute } from "../tool-execute.ts";

/**
 * Prediction tools for paper sessions (fork #8 — docs/papers-feed.md):
 * TEACHER only, registered only when the session reads a paper. The record
 * lives on the paper — the learner's research-taste calibration.
 *
 *   record_prediction  — the learner's committed prediction (BEFORE the
 *                        results are revealed) + their confidence
 *   resolve_prediction — after the reveal: held / partly / missed
 */

export interface PredictionToolContext {
	record: (statement: string, confidence: number) => { id: string };
	resolve: (predictionId: string, outcome: "held" | "partly" | "missed") => void;
}

const recordInput = Type.Object({
	statement: Type.String({ minLength: 1, description: "The learner's prediction, in their words, specific enough to check against the results." }),
	confidence: Type.Integer({ minimum: 50, maximum: 99, description: "How sure the learner said they are, 50–99 (%). Ask them; never guess it." }),
});

const resolveInput = Type.Object({
	predictionId: Type.String({ minLength: 1, description: "The id record_prediction returned." }),
	outcome: Type.Union([Type.Literal("held"), Type.Literal("partly"), Type.Literal("missed")], {
		description: "held = the results match; partly = the direction or part of it held; missed = they didn't.",
	}),
});

export function predictionTools(ctx: PredictionToolContext): Record<string, AgentTool<any>> {
	return {
		record_prediction: {
			name: "record_prediction",
			label: "record_prediction",
			description: "Record the learner's committed prediction about the paper's results, with their confidence — BEFORE revealing the results. Returns its id.",
			parameters: recordInput,
			execute: serverExecute("record_prediction", recordInput, async ({ statement, confidence }) => {
				const { id } = ctx.record(statement, confidence);
				return `Prediction recorded (id ${id}). Resolve it with resolve_prediction after the results are revealed.`;
			}),
		},
		resolve_prediction: {
			name: "resolve_prediction",
			label: "resolve_prediction",
			description: "After revealing the paper's results, record whether the learner's prediction held.",
			parameters: resolveInput,
			execute: serverExecute("resolve_prediction", resolveInput, async ({ predictionId, outcome }) => {
				ctx.resolve(predictionId, outcome);
				return "Outcome recorded.";
			}),
		},
	};
}
