import { Type } from "typebox";
import type { Usage } from "@earendil-works/pi-ai";
import type { SearchProvider } from "../../core/search.ts";
import type { SeedArea } from "../../core/fieldmap.ts";
import type { FieldProposalKind } from "../../core/contracts.ts";
import type { PiEngine } from "../models.ts";
import { createWebTools } from "../tools/web.ts";
import { runSubmitAgent } from "./submit-agent.ts";

/**
 * THE CARTOGRAPHER (fork #10 — docs/field-map.md): builds and maintains the
 * AI safety field map. Two single-submit agents:
 *
 *   describeArea — (cheap slot, role "librarian") rewrites one seed area's
 *                  agendas IN ITS OWN WORDS (the seed is unlicensed — never
 *                  copied) with a summary, a theory of change, and 4–8 key
 *                  concepts per agenda
 *   refineMap    — (strong slot, role "cartographer") researches what changed
 *                  in the field since a date with web search, and submits
 *                  concrete changes (add / edit / dormant / remove) with
 *                  reasons and sources
 */

export interface CartographerRun {
	engine: PiEngine;
	signal?: AbortSignal;
	onUsage?: (usage: Usage) => void;
}

const step = (run: CartographerRun) => (usage: Usage) => run.onUsage?.(usage);

// ─── describe one area ───────────────────────────────────────────────────────

const DESCRIBE_PROMPT = `You write entries for a map of technical AI safety research inside a learning application. The reader is learning the field and wants to see what each research agenda is and what understanding it takes.

You get one area of the field with its research agendas (name, a source summary, a source theory of change). For the area, write a one-sentence summary. For each agenda write, ENTIRELY IN YOUR OWN WORDS (never copy the source's sentences):
- title: a short clear name (keep the source name unless it is cryptic)
- summary: 1–2 plain sentences on what the agenda does
- theoryOfChange: 1–2 sentences on why it would make AI safer
- concepts: 4–8 key concepts a learner must understand to follow the agenda's work. Each is a SHORT SELF-CONTAINED STATEMENT of the idea, not a label ("Sparse autoencoders decompose activations into many sparsely-active, more interpretable features", not "SAEs"). Order from foundational to specific.

Submit every agenda exactly once with submit_area, using the given keys.`;

const describeSchema = Type.Object({
	areaSummary: Type.String({ minLength: 1 }),
	agendas: Type.Array(
		Type.Object({
			key: Type.String({ minLength: 1 }),
			title: Type.String({ minLength: 1 }),
			summary: Type.String({ minLength: 1 }),
			theoryOfChange: Type.String({ minLength: 1 }),
			concepts: Type.Array(Type.String({ minLength: 1 }), { minItems: 3, maxItems: 8 }),
		}),
	),
});

export interface DescribedAgenda {
	key: string;
	title: string;
	summary: string;
	theoryOfChange: string;
	concepts: string[];
}

export async function describeArea(
	area: SeedArea,
	run: CartographerRun,
): Promise<{ areaSummary: string; agendas: DescribedAgenda[] }> {
	const keys = area.agendas.map((_, i) => `a${i + 1}`);
	const want = new Set(keys);
	return runSubmitAgent<{ areaSummary: string; agendas: DescribedAgenda[] }>({
		role: "librarian",
		toolName: "submit_area",
		toolDescription: "Submit the area summary and every agenda's entry (by key).",
		parameters: describeSchema,
		fill: (input: { areaSummary: string; agendas: DescribedAgenda[] }) => ({
			areaSummary: input.areaSummary,
			agendas: input.agendas.filter((a) => want.has(a.key)),
		}),
		validate: (value) => {
			const got = new Set(value.agendas.map((a) => a.key));
			const missing = keys.filter((k) => !got.has(k));
			return missing.length > 0 ? `Missing agendas: ${missing.join(", ")}. Submit every key once.` : null;
		},
		systemPrompt: DESCRIBE_PROMPT,
		prompt: [
			`Area: ${area.title}`,
			...area.agendas.map(
				(a, i) =>
					`[${keys[i]}] ${a.name}\nSource summary: ${a.summary.slice(0, 600) || "(none)"}\nSource theory of change: ${a.theoryOfChange.slice(0, 800) || "(none)"}`,
			),
		].join("\n\n"),
		engine: run.engine,
		signal: run.signal,
		onStep: step(run),
		neverSubmitted: `The cartographer did not describe the area "${area.title}".`,
	});
}

// ─── refine / update ─────────────────────────────────────────────────────────

const REFINE_PROMPT = `You keep a learning application's map of TECHNICAL AI SAFETY research current. The map is a set of areas, each with research agendas.

Research what has changed in the field since the given date, using web_search and web_fetch on strong sources: recent consensus documents (e.g. the Singapore Consensus on Global AI Safety Research Priorities), maps of the field (e.g. aisafetyagendas.com, newer Shallow Review editions), frontier labs' research-direction posts, and notable recent Alignment Forum / arXiv work.

Then submit concrete changes with submit_changes — only well-supported, significant ones:
- add: an established new agenda (or a new area) that is missing — with title, summary, theoryOfChange, and 4–8 concepts written in your own words (concepts are short self-contained statements, foundational first)
- edit: an agenda whose description is now wrong or materially outdated (give the full revised entry)
- dormant: an agenda with no meaningful activity for over a year
- remove: a duplicate or something that is not technical AI safety
Every change needs a one-sentence reason and the URLs that support it. Prefer a few strong changes over many weak ones (at most 15). Do not restructure the map for taste; do not add policy/governance work. If nothing qualifies, submit an empty list.`;

const changeSchema = Type.Object({
	changes: Type.Array(
		Type.Object({
			kind: Type.Union([Type.Literal("add"), Type.Literal("edit"), Type.Literal("dormant"), Type.Literal("remove")]),
			areaTitle: Type.String({ minLength: 1, description: "The area's title (an existing one, or a new one for an add)." }),
			agendaId: Type.Optional(Type.String({ description: "The agenda's id (edit / dormant / remove)." })),
			agenda: Type.Optional(
				Type.Object({
					title: Type.String({ minLength: 1 }),
					summary: Type.String({ minLength: 1 }),
					theoryOfChange: Type.String({ minLength: 1 }),
					concepts: Type.Array(Type.String({ minLength: 1 }), { minItems: 3, maxItems: 8 }),
				}),
			),
			reason: Type.String({ minLength: 1 }),
			sources: Type.Array(Type.String({ minLength: 1 })),
		}),
		{ maxItems: 15 },
	),
});

export interface ProposedChange {
	kind: FieldProposalKind;
	areaTitle: string;
	agendaId?: string;
	agenda?: { title: string; summary: string; theoryOfChange: string; concepts: string[] };
	reason: string;
	sources: string[];
}

export async function refineMap(
	input: { mapText: string; since: string; agendaIds: readonly string[] },
	run: CartographerRun & { search?: () => SearchProvider | null },
): Promise<ProposedChange[]> {
	const ids = new Set(input.agendaIds);
	const web = createWebTools(run.search ?? (() => null));
	return runSubmitAgent<ProposedChange[]>({
		role: "cartographer",
		toolName: "submit_changes",
		toolDescription: "Submit the map changes (possibly none).",
		parameters: changeSchema,
		fill: (v: { changes: ProposedChange[] }) => v.changes,
		validate: (changes) => {
			for (const c of changes) {
				if ((c.kind === "add" || c.kind === "edit") && !c.agenda) return `A ${c.kind} change needs the full agenda entry ("${c.reason}").`;
				if (c.kind !== "add" && (!c.agendaId || !ids.has(c.agendaId))) return `"${c.agendaId ?? ""}" is not an agenda id on the map — copy one exactly.`;
			}
			return null;
		},
		systemPrompt: REFINE_PROMPT,
		prompt: `Today's date: ${new Date().toISOString().slice(0, 10)}. Changes since: ${input.since}.\n\nThe current map (area › [agenda id] title — summary):\n${input.mapText}`,
		engine: run.engine,
		signal: run.signal,
		onStep: step(run),
		neverSubmitted: "The cartographer did not submit its changes.",
		extraTools: { web_search: web.web_search!, web_fetch: web.web_fetch! },
		maxTurns: 24,
	});
}
