import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { serverExecute } from "../tool-execute.ts";
import { EXERCISE_CATALOG, searchCatalog } from "../../core/exercise-catalog.ts";

/**
 * Exercise tools (fork #11 — docs/exercises-progress.md): TEACHER only.
 * Exercises live inside teaching chats — never a separate page.
 *
 *   find_exercises   — search the starting catalog (ARENA, CS336, Zero to
 *                      Hero, Deep-ML, StaffML, puzzles, LeetGPU)
 *   suggest_exercise — put an exercise card in the chat (title, source,
 *                      link, why); the learner marks it Done / Struggled.
 *                      Any good source is fine — the catalog is a start,
 *                      not a limit (find others with research).
 */

const findInput = Type.Object({
	query: Type.String({ minLength: 1, description: "What the learner should practice, in a few words (e.g. 'sparse autoencoders', 'PPO', 'attention from scratch')." }),
});

const suggestInput = Type.Object({
	title: Type.String({ minLength: 1, description: "The exercise's name." }),
	url: Type.String({ minLength: 1, description: "A real link to it (from find_exercises or a research brief) — never invented." }),
	source: Type.String({ minLength: 1, description: "Where it's from (e.g. 'ARENA', 'Deep-ML')." }),
	why: Type.String({ minLength: 1, description: "One line: what it practices from this session and why it fits the learner now." }),
	catalogId: Type.Optional(Type.String({ description: "The catalog id, when it came from find_exercises." })),
});

export function exerciseTools(): Record<string, AgentTool<any>> {
	return {
		find_exercises: {
			name: "find_exercises",
			label: "find_exercises",
			description:
				"Search the starting catalog of external practice (ARENA, Stanford CS336, Karpathy's Zero to Hero, Deep-ML, StaffML, Sasha Rush's puzzles, LeetGPU) for exercises on a topic. " +
				"The catalog is a starting point — if nothing fits, use research to find good exercises elsewhere.",
			parameters: findInput,
			execute: serverExecute("find_exercises", findInput, async ({ query }) => {
				const hits = searchCatalog(query);
				if (hits.length === 0) return `No catalog exercises match "${query}" (${EXERCISE_CATALOG.length} in the catalog). Use research to find good exercises elsewhere, or suggest none.`;
				return hits.map((h) => `- [${h.id}] ${h.title} (${h.source}) — ${h.url}`).join("\n");
			}),
		},
		suggest_exercise: {
			name: "suggest_exercise",
			label: "suggest_exercise",
			description:
				"Show the learner an exercise card in the chat (title, source, link, why it fits). They can mark it Done or Struggled. Suggest 1–3 at a natural point — never as homework.",
			parameters: suggestInput,
			execute: serverExecute("suggest_exercise", suggestInput, async (input) => {
				if (!/^https?:\/\//.test(input.url)) return { ok: false, error: "The url must be a real http(s) link." };
				return { text: `Exercise card shown: ${input.title}.`, details: { ...input } };
			}),
		},
	};
}
