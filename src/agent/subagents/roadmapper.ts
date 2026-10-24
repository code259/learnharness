import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { Usage } from "@earendil-works/pi-ai";
import type { GoalMessage, PlanTree } from "../../core/contracts.ts";
import type { ChatStore, GraphStore } from "../../core/ports.ts";
import type { SearchProvider } from "../../core/search.ts";
import { createTree, PlanTreeError } from "../../core/plan-tree.ts";
import { serverExecute } from "../tool-execute.ts";
import { parseMermaidPlan } from "../tools/mermaid-plan.ts";
import { proberGraphTools } from "../tools/graph.ts";
import { createWebTools } from "../tools/web.ts";
import type { PiEngine } from "../models.ts";
import { runSubagent } from "./pi-run.ts";

/**
 * THE ROADMAP AGENT (goals, fork #4 — docs/goals-roadmaps.md): drafts and
 * revises a goal's roadmap, a DAG of session-sized TOPICS. One isolated
 * sub-agent loop per request (the researcher's shape): the goals service
 * builds the prompt from the goal record + derived topic statuses, and the
 * agent writes the roadmap through ONE tool, roadmap_write — the plan_init
 * protocol one scale up (mermaid in, createTree validation, slugs permanent).
 *
 * Three entry tasks share it: the first DRAFT (fired by the prober's
 * roadmap offer), a learner REQUEST on the roadmap page, and APPLYING a
 * suggestion a linked session filed. The final assistant text is the reply
 * shown in the roadmap-page conversation.
 */

export const ROADMAP_INSTRUCTIONS = `You maintain a learner's long-term ROADMAP inside a learning application.

The application teaches in sessions. Each session measures what the learner already holds (a probe), plans a minimal path to the session's goal, and teaches it one reasoning step at a time; what he learns accumulates into a persistent knowledge graph. A roadmap sits ABOVE sessions: a dependency map of TOPICS for a goal that takes many sessions — weeks or months.

## What a topic is
- One topic = one session's goal: roughly one to a few teaching sessions' worth, concrete enough that a session can start from it ("Scaled dot-product attention", "KL divergence and why RLHF penalizes it", "Training a sparse autoencoder on residual activations").
- Its title is a short label. Its summary (1–2 sentences) states the understanding the session should reach — it becomes that session's goal, so make it specific.
- NOT a proposition (that is the session plan's job) and NOT a whole field ("Machine learning").

## The map
- \`-->\` means "from must be covered before to". Draw the real dependencies only; independent branches stay parallel so several topics can be available at once.
- The minimal map: nothing he already holds (check the knowledge graph with list_sessions / list_propositions, and the notes you are given), nothing off the path to his goal however interesting. Start from what he holds, not below it.
- As many topics as the goal genuinely needs — elaborate is fine, wrong is not. Typical: 8–25.
- For fast-moving fields, verify the current state with web_search / web_fetch before committing to the map (real agendas, real methods, real canonical papers). Never invent papers or results.
- No dates, deadlines, or schedules — ever. Pace is the learner's.

## Writing it — roadmap_write
- One mermaid block (graph TD), one node per line \`slug[Short title]\`, slugs are PERMANENT lowercase ids (a-z, 0-9, hyphens). Plus \`summaries\`: one {id, summary} entry per topic.
- A rewrite replaces the whole map, so carry over every topic you keep with its SAME slug. Topics that already have sessions MUST be kept (the tool refuses otherwise) — you may retitle or re-summarize them, or move their edges.
- If the tool returns problems, fix them and call it again.

## Your reply
After writing, reply to the learner in a few plain sentences: what the map is built around, and what changed and why. Never restate the whole map in prose — he sees it drawn. If the request needs no map change, say so and don't call the tool. If something is ambiguous, make the most sensible choice and say what you assumed.`;

/** What the roadmap tool closes over. */
export interface RoadmapWriteContext {
	/** Topic ids that already have linked sessions — must survive a rewrite. */
	pinnedTopicIds: readonly string[];
	/** Persist the validated roadmap (the goals service owns the store). */
	save: (roadmap: PlanTree) => void;
}

const roadmapWriteInput = Type.Object({
	mermaid: Type.String({
		minLength: 1,
		description:
			"The whole roadmap as a mermaid graph block, e.g.:\ngraph TD\n  linear-algebra[Linear algebra for ML] --> attention[Scaled dot-product attention]\n" +
			"Ids are permanent lowercase slugs (a-z, 0-9, hyphens); `-->` means 'from must be covered first'. No subgraphs, styles, or classes.",
	}),
	summaries: Type.Optional(
		Type.Array(
			Type.Object({
				id: Type.String({ description: "A topic slug from the mermaid block." }),
				summary: Type.String({ description: "1–2 sentences: the understanding that topic's session should reach." }),
			}),
			{ description: "One entry per topic." },
		),
	),
});

/** roadmap_write — parse → validate (createTree: unique ids, endpoints, no
 *  cycles) → the pinned-topic check → save. Problems return to the agent. */
export function roadmapWriteTool(ctx: RoadmapWriteContext): AgentTool<any> {
	return {
		name: "roadmap_write",
		label: "roadmap_write",
		description:
			"Write or REWRITE the whole roadmap: a mermaid graph block of topics plus one summary per topic. The new block replaces the old map; keep the slugs of topics you carry over.",
		parameters: roadmapWriteInput,
		execute: serverExecute("roadmap_write", roadmapWriteInput, async ({ mermaid, summaries }) => {
			const parsed = parseMermaidPlan(mermaid);
			if (!parsed.ok || !parsed.plan) return { ok: false, error: parsed.problems.join("\n") };
			const ids = new Set(parsed.plan.nodes.map((n) => n.id));
			const missing = ctx.pinnedTopicIds.filter((id) => !ids.has(id));
			if (missing.length > 0) {
				return {
					ok: false,
					error: `These topics already have sessions and must stay on the map (same slug): ${missing.join(", ")}.`,
				};
			}
			const summaryOf = new Map((summaries ?? []).map((e) => [e.id, e.summary.trim()]));
			const nodes = parsed.plan.nodes.map((n) => {
				const summary = summaryOf.get(n.id);
				return summary ? { ...n, summary } : n;
			});
			try {
				const tree = createTree(nodes, parsed.plan.edges);
				ctx.save(tree);
				return { ok: true, topics: tree.nodes.length };
			} catch (err) {
				if (err instanceof PlanTreeError) return { ok: false, error: err.message };
				throw err;
			}
		}),
	};
}

export interface RoadmapperRequest {
	goalStatement: string;
	/** Derived status lines of the current map (core/goals.ts
	 *  roadmapStatusLines); empty before the first draft. */
	roadmapLines: readonly string[];
	/** The roadmap-page conversation so far (oldest first). */
	history: readonly GoalMessage[];
	/** What to do now — the drafting brief, the learner's message, or the
	 *  suggestion to apply. */
	task: string;
}

export interface RoadmapperRunOptions extends RoadmapWriteContext {
	engine: PiEngine;
	/** The learner's knowledge-graph readers (absent = graph tools off). */
	graph?: { chatStore: ChatStore; graphStore: GraphStore };
	/** The live search seam (null = honestly unavailable; web_fetch stays). */
	search?: () => SearchProvider | null;
	abortSignal?: AbortSignal;
	onUsage?: (usage: Usage) => void;
	onToolStart?: (toolName: string, args: unknown) => void;
}

/** The single prompt (history folded in as a transcript block — the
 *  agent is stateless per request, the goal record is the memory). */
export function roadmapperPrompt(req: RoadmapperRequest): string {
	const parts = [`The learner's goal: ${req.goalStatement}`];
	parts.push(
		req.roadmapLines.length > 0
			? `The current roadmap (topic: derived status), prerequisites first:\n${req.roadmapLines.join("\n")}`
			: "There is no roadmap yet — this is the first draft.",
	);
	const recent = req.history.slice(-20);
	if (recent.length > 0) {
		parts.push(
			`The roadmap conversation so far:\n${recent.map((m) => `${m.role === "user" ? "Learner" : "You"}: ${m.text}`).join("\n\n")}`,
		);
	}
	parts.push(`Now:\n${req.task}`);
	return parts.join("\n\n");
}

/** Run the roadmap agent once. Returns its reply text (the roadmap, if
 *  written, was already saved through ctx.save). Throws on engine failure
 *  or abort (the pi-run semantics) — the service records the error. */
export async function runRoadmapper(req: RoadmapperRequest, opts: RoadmapperRunOptions): Promise<string> {
	const tools: AgentTool<any>[] = [
		roadmapWriteTool({ pinnedTopicIds: opts.pinnedTopicIds, save: opts.save }),
		...Object.values(createWebTools(opts.search ?? (() => null))),
		...(opts.graph ? Object.values(proberGraphTools(opts.graph)) : []),
	];
	const { text } = await runSubagent(tools, {
		role: "roadmapper",
		engine: opts.engine,
		systemPrompt: ROADMAP_INSTRUCTIONS,
		prompt: roadmapperPrompt(req),
		maxTurns: 16,
		abortSignal: opts.abortSignal,
		onUsage: opts.onUsage,
		onToolStart: opts.onToolStart,
	});
	return text.trim();
}

// ─── books (library, fork #15) ───────────────────────────────────────────────

/**
 * The task wrapper for a goal that FOLLOWS a book ("Study this book" — the
 * one opt-in book-following mode). Every other goal's task passes through
 * untouched: no book content ever reaches a normal roadmap draft (the
 * guardrail; pinned in tests).
 */
export function roadmapTaskFor(task: string, followedBook: { title: string; outline: string } | null): string {
	if (!followedBook) return task;
	return [
		task,
		`This goal is to WORK THROUGH the book “${followedBook.title}” — the learner chose to follow it. Build the map around the book's structure (chapters or groups of sections as topics, in a sensible prerequisite order), still leaving out what he already holds and adding a foundation topic where the book assumes something he lacks. Topic summaries name the book pages they cover.`,
		`The book's outline (PDF pages):\n${followedBook.outline}`,
	].join("\n\n");
}

export const COMPARE_INSTRUCTIONS = `You compare a learner's long-term ROADMAP against the reference books pinned to that goal, inside a learning application.

The books are references and yardsticks — never the curriculum. Your only output is SUGGESTIONS the learner may apply or dismiss on the roadmap page; you cannot change the roadmap.

File a suggestion (file_suggestion) only for something that (a) a book covers in substance, (b) genuinely matters for the learner's goal, (c) the roadmap does not already cover, and (d) the learner does not already hold (sections marked covered). One suggestion per gap, phrased as a topic to add or a change to a topic, naming the book section and pages as evidence. At most 6 suggestions, the most important first. Never suggest reorganizing the roadmap to follow a book's order. If nothing qualifies, file nothing.

Then reply in two or three plain sentences: what you compared and what you filed (or that the roadmap already covers what matters).`;

export interface CompareBook {
	id: string;
	title: string;
	/** Per section: title, pages, coverage, key ideas. */
	sectionLines: string[];
}

export async function runRoadmapCompare(
	req: { goalStatement: string; roadmapLines: readonly string[]; books: readonly CompareBook[] },
	opts: {
		engine: PiEngine;
		fileSuggestion: (bookId: string, text: string) => void;
		graph?: { chatStore: ChatStore; graphStore: GraphStore };
		abortSignal?: AbortSignal;
		onUsage?: (usage: Usage) => void;
	},
): Promise<string> {
	const ids = new Set(req.books.map((b) => b.id));
	const fileInput = Type.Object({
		book: Type.String({ minLength: 1, description: "The book id the gap comes from." }),
		suggestion: Type.String({ minLength: 1, description: "The topic to add or change, with the book section + pages as evidence." }),
	});
	let filed = 0;
	const fileTool: AgentTool<any> = {
		name: "file_suggestion",
		label: "file_suggestion",
		description: "File one roadmap suggestion (the learner applies or dismisses it). At most 6 per comparison.",
		parameters: fileInput,
		execute: serverExecute("file_suggestion", fileInput, async ({ book, suggestion }) => {
			if (!ids.has(book)) return { ok: false, error: `Unknown book id "${book}" — use one of: ${[...ids].join(", ")}` };
			if (filed >= 6) return { ok: false, error: "Six suggestions already filed — stop and reply." };
			opts.fileSuggestion(book, suggestion);
			filed++;
			return { ok: true };
		}),
	};
	const prompt = [
		`The learner's goal: ${req.goalStatement}`,
		req.roadmapLines.length > 0 ? `The roadmap (topic: derived status):\n${req.roadmapLines.join("\n")}` : "The roadmap is empty.",
		...req.books.map((b) => `Book [${b.id}] ${b.title} — sections (coverage of his knowledge; key ideas):\n${b.sectionLines.join("\n")}`),
		"Compare now.",
	].join("\n\n");
	const { text } = await runSubagent([fileTool, ...(opts.graph ? Object.values(proberGraphTools(opts.graph)) : [])], {
		role: "roadmapper",
		engine: opts.engine,
		systemPrompt: COMPARE_INSTRUCTIONS,
		prompt,
		maxTurns: 12,
		abortSignal: opts.abortSignal,
		onUsage: opts.onUsage,
	});
	return text.trim();
}
