import { Type } from "typebox";
import type { Usage } from "@earendil-works/pi-ai";
import type { OutlineEntry } from "../../core/library.ts";
import type { IdeaStatus } from "../../core/contracts.ts";
import type { PiEngine } from "../models.ts";
import { createPdfReadTools } from "../tools/pdf-read.ts";
import { runSubmitAgent } from "./submit-agent.ts";

/**
 * THE LIBRARIAN (fork #15 — docs/library.md): the library's background
 * reader on the CHEAP slot. Three single-submit agents (runSubmitAgent):
 *
 *   outline  — fallback when a PDF has no bookmarks: reads the table of
 *              contents with the PDF tools, locates headings, submits
 *              chapters/sections with PDF page numbers
 *   ideas    — 3–6 key ideas per section from the section's own text
 *   coverage — judges each idea against candidate propositions from the
 *              learner's knowledge graph: held / partly / not-yet
 *
 * It describes the book; it never plans learning (the guardrail).
 */

export interface LibrarianRun {
	engine: PiEngine;
	signal?: AbortSignal;
	onUsage?: (usage: Usage) => void;
}

const step = (run: LibrarianRun) => (usage: Usage) => run.onUsage?.(usage);

// ─── outline fallback ────────────────────────────────────────────────────────

const OUTLINE_PROMPT = `You map the structure of a book (a PDF) for a learning application's library.

Find the table of contents (usually within the first 30 pages) with pdf_extract, and determine the chapters and their main sections. Printed page numbers usually differ from PDF page numbers (front matter offsets them): confirm where chapters really start with pdf_search on their headings, and report PDF page numbers.

Submit with submit_outline: level 1 = chapters (include appendices if substantial), level 2 = the main sections within each chapter. Skip front matter (preface, contents, acknowledgements) and back matter (index, bibliography). Reading order; page = the 1-indexed PDF page where the entry starts.`;

const outlineSchema = Type.Object({
	entries: Type.Array(
		Type.Object({
			title: Type.String({ minLength: 1 }),
			level: Type.Integer({ minimum: 1, maximum: 2 }),
			page: Type.Integer({ minimum: 1 }),
		}),
		{ minItems: 1 },
	),
});

export async function outlineFromToc(pdfPath: string, bookDir: string, pageCount: number, run: LibrarianRun): Promise<OutlineEntry[]> {
	const pdfTools = createPdfReadTools(bookDir);
	return runSubmitAgent<OutlineEntry[]>({
		role: "librarian",
		toolName: "submit_outline",
		toolDescription: "Submit the book's chapters (level 1) and main sections (level 2) with the PDF page each starts on.",
		parameters: outlineSchema,
		fill: (input: { entries: OutlineEntry[] }) => input.entries.map((e) => ({ title: e.title, level: e.level, page: e.page })),
		validate: (entries) =>
			entries.some((e) => (e.page ?? 0) > pageCount)
				? `The book has ${pageCount} pages — every page must be between 1 and ${pageCount}.`
				: entries.filter((e) => e.level === 1).length === 0
					? "Include at least one chapter (level 1)."
					: null,
		systemPrompt: OUTLINE_PROMPT,
		prompt: `The book's PDF: ${pdfPath} (${pageCount} pages). Map its chapters and main sections.`,
		engine: run.engine,
		signal: run.signal,
		onStep: step(run),
		neverSubmitted: "The librarian could not map the book's table of contents.",
		extraTools: { pdf_extract: pdfTools.pdf_extract!, pdf_search: pdfTools.pdf_search! },
		maxTurns: 14,
	});
}

// ─── key ideas ───────────────────────────────────────────────────────────────

const IDEAS_PROMPT = `You summarize sections of a technical book into KEY IDEAS for a learning application.

For each section you are given its title and text. Write 3–6 key ideas per section (fewer for a very short section): each one self-contained, specific, and phrased as a claim or concept a reader should come away understanding ("The KL penalty keeps the policy close to the reference model, limiting reward hacking"), not a topic label ("KL penalty"). Use the book's own terms. Skip exercises, references, and filler.

Submit every section exactly once with submit_ideas, using the given section ids.`;

const ideasSchema = Type.Object({
	sections: Type.Array(
		Type.Object({
			id: Type.String({ minLength: 1 }),
			ideas: Type.Array(Type.String({ minLength: 1 }), { minItems: 1, maxItems: 8 }),
		}),
	),
});

export interface SectionText {
	id: string;
	title: string;
	text: string;
}

export async function keyIdeas(sections: readonly SectionText[], run: LibrarianRun): Promise<Record<string, string[]>> {
	const want = new Set(sections.map((s) => s.id));
	const result = await runSubmitAgent<Record<string, string[]>>({
		role: "librarian",
		toolName: "submit_ideas",
		toolDescription: "Submit the key ideas for every given section (by id).",
		parameters: ideasSchema,
		fill: (input: { sections: { id: string; ideas: string[] }[] }) =>
			Object.fromEntries(input.sections.filter((s) => want.has(s.id)).map((s) => [s.id, s.ideas.slice(0, 6)])),
		validate: (value) => {
			const missing = [...want].filter((id) => !value[id]);
			return missing.length > 0 ? `Missing sections: ${missing.join(", ")}. Submit every section id once.` : null;
		},
		systemPrompt: IDEAS_PROMPT,
		prompt: sections.map((s) => `### [${s.id}] ${s.title}\n\n${s.text}`).join("\n\n---\n\n"),
		engine: run.engine,
		signal: run.signal,
		onStep: step(run),
		neverSubmitted: "The librarian did not submit key ideas.",
	});
	return result;
}

// ─── coverage judging ────────────────────────────────────────────────────────

const COVERAGE_PROMPT = `You compare a book's key ideas against what a learner already understands, for a learning application.

For each idea you get candidate propositions from the learner's knowledge graph (things they learned in past sessions). Judge each idea:
- held — the propositions together express the idea (or something that clearly contains it)
- partly — they cover part of it, or a closely related but narrower point
- not-yet — nothing here amounts to the idea (topical similarity alone is not enough)

Be strict: shared vocabulary is not understanding. Submit every idea exactly once with submit_judgements.`;

const judgementSchema = Type.Object({
	judgements: Type.Array(
		Type.Object({
			key: Type.String({ minLength: 1 }),
			status: Type.Union([Type.Literal("held"), Type.Literal("partly"), Type.Literal("not-yet")]),
		}),
	),
});

export interface IdeaToJudge {
	/** Stable key ("<sectionId>#<index>"). */
	key: string;
	idea: string;
	candidates: { name: string; statement: string }[];
}

export async function judgeIdeas(items: readonly IdeaToJudge[], run: LibrarianRun): Promise<Record<string, IdeaStatus>> {
	const want = new Set(items.map((i) => i.key));
	return runSubmitAgent<Record<string, IdeaStatus>>({
		role: "librarian",
		toolName: "submit_judgements",
		toolDescription: "Submit held / partly / not-yet for every given idea key.",
		parameters: judgementSchema,
		fill: (input: { judgements: { key: string; status: IdeaStatus }[] }) =>
			Object.fromEntries(input.judgements.filter((j) => want.has(j.key)).map((j) => [j.key, j.status])),
		validate: (value) => {
			const missing = [...want].filter((k) => !value[k]);
			return missing.length > 0 ? `Missing ideas: ${missing.join(", ")}. Judge every key once.` : null;
		},
		systemPrompt: COVERAGE_PROMPT,
		prompt: items
			.map(
				(i) =>
					`[${i.key}] ${i.idea}\nCandidates:\n${i.candidates.map((c) => `  - ${c.name}: ${c.statement}`).join("\n")}`,
			)
			.join("\n\n"),
		engine: run.engine,
		signal: run.signal,
		onStep: step(run),
		neverSubmitted: "The librarian did not submit coverage judgements.",
	});
}
