/**
 * THE FIELD-MAP SERVICE (fork #10 — docs/field-map.md): the sole writer of
 * data/fieldmap. Builds the AI safety map (seed download → per-area rewrite
 * in the app's own words → a refinement pass whose changes apply directly on
 * the first build), runs "Update the map" (the same refinement, but as
 * proposals the learner accepts or rejects), keeps coverage against the
 * knowledge graph fresh on demand, and owns the agenda actions.
 *
 * A mirror, never a driver: nothing here changes a roadmap or a session on
 * its own — the learner acts from the map.
 */

import type { FieldArea, FieldMapRecord, FieldMapView, FieldProposal, IdeaStatus } from "../core/contracts.ts";
import { allAgendas, applyProposal, areaViews, fieldTotals, parseCsv, seedAreas, uniqueId, type SeedArea } from "../core/fieldmap.ts";
import { ideaCandidates } from "../core/library.ts";
import { newAgendaContextMessage } from "../core/native-messages.ts";
import { getGraph } from "../core/graph.ts";
import { emit } from "../core/events.ts";
import { describeArea, refineMap, type ProposedChange } from "../agent/subagents/cartographer.ts";
import { judgeIdeas, type IdeaToJudge } from "../agent/subagents/librarian.ts";
import { stores } from "./stores.ts";
import { graphRevision } from "./graph.ts";
import { stampStrongSlot } from "./chats.ts";
import { searchProvider } from "./search.ts";
import { engineForRole, GoalServiceError } from "./agent-engines.ts";
import { createGoalWithDraft, sendRoadmapMessage } from "./goals.ts";

/** The seed: the Shallow Review of Technical AI Safety 2025's agenda export.
 *  Downloaded at build time for the learner's own use and rewritten — never
 *  committed (the repo carries no license). */
export const SEED_CSV_URL =
	"https://raw.githubusercontent.com/arb-consulting/shallow-review-2025/main/main-pipeline/data/2025-12-16-draft-post-review/agendas.csv";
export const SEED_SOURCE = { title: "Shallow Review of Technical AI Safety, 2025 (Arb Research)", url: "https://shallowreview.ai" };
/** The seed's cut-off — the first refinement looks for changes since. */
const SEED_DATE = "2025-12-16";
const JUDGE_BATCH = 40;
const RUN_KEY = "fieldmap";

// ─── liveness ────────────────────────────────────────────────────────────────

interface LhFieldMapGlobal {
	__lhFieldMapRun?: boolean;
}
function g(): LhFieldMapGlobal {
	return globalThis as typeof globalThis & LhFieldMapGlobal;
}
export function isFieldMapWorking(): boolean {
	return g().__lhFieldMapRun === true;
}

function emptyRecord(): FieldMapRecord {
	return { status: "empty", sources: [], areas: [], coverage: null, proposals: [], changes: [] };
}

function current(): FieldMapRecord {
	return stores.fieldMapStore.read() ?? emptyRecord();
}

function save(patch: Partial<FieldMapRecord>): FieldMapRecord {
	const next = { ...current(), ...patch };
	stores.fieldMapStore.write(next);
	return next;
}

/** One background run at a time; failures land on the record. */
function startRun(work: () => Promise<void>, onError: (reason: string) => void): void {
	if (isFieldMapWorking()) throw new GoalServiceError("The field map is already being worked on", 409);
	g().__lhFieldMapRun = true;
	emit("fieldmap-changed", {});
	void (async () => {
		try {
			await work();
		} catch (err) {
			console.error(`[${RUN_KEY}] run failed:`, err);
			onError(err instanceof Error ? err.message : String(err));
		} finally {
			g().__lhFieldMapRun = false;
			emit("fieldmap-changed", {});
		}
	})();
}

/** Injectable for tests (the seed download). */
export const seedFetch: { current: (url: string) => Promise<string> } = {
	current: async (url) => {
		const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
		if (!res.ok) throw new Error(`The seed download failed (HTTP ${res.status})`);
		return res.text();
	},
};

const REFUSAL = "ChatGPT background use is off, so the field map can't be built in the background. Allow background use in Providers.";

// ─── build ───────────────────────────────────────────────────────────────────

/** Build the map (or resume a partial build: areas already described are
 *  kept). The first refinement applies its changes directly and logs them. */
export function buildFieldMap(): void {
	startRun(
		async () => {
			let record = save({ status: "building", error: undefined, progress: "Downloading the seed map" });
			const seed = seedAreas(parseCsv(await seedFetch.current(SEED_CSV_URL)));
			if (seed.length === 0) throw new Error("The seed map was empty — the source may have moved.");
			// The learner clicked Build: foreground for ChatGPT's background-use rule.
			const describer = await engineForRole("librarian", false, REFUSAL);
			const done = new Set(record.areas.map((a) => a.title.toLowerCase()));
			const used = new Set([...record.areas.map((a) => a.id), ...allAgendas(record.areas).map((x) => x.id)]);
			let areas: FieldArea[] = [...record.areas];
			for (const [i, area] of seed.entries()) {
				if (done.has(area.title.toLowerCase())) continue;
				save({ progress: `Describing areas: ${i + 1} / ${seed.length} (${area.title})` });
				areas = [...areas, await describedArea(area, used, describer)];
				record = save({ areas });
			}
			save({ progress: "Checking the map against newer sources", sources: [SEED_SOURCE] });
			try {
				const changes = await runRefinement(SEED_DATE, false);
				record = current();
				let next = record.areas;
				const log = [...record.changes];
				for (const c of changes) {
					next = applyProposal(next, c);
					log.push({ at: new Date().toISOString(), summary: changeSummary(c, record.areas) });
				}
				save({ areas: next, changes: log, sources: mergeSources(record.sources, changes) });
			} catch (err) {
				// The seed map stands on its own; refinement can be rerun as an update.
				save({ error: `The refinement pass couldn't run (${err instanceof Error ? err.message : String(err)}). Use “Update the map” to retry.` });
			}
			const now = new Date().toISOString();
			save({ status: "ready", progress: undefined, builtAt: current().builtAt ?? now, updatedAt: now });
			await checkCoverage(false, false);
		},
		(reason) => save({ status: "error", progress: undefined, error: reason }),
	);
}

async function describedArea(area: SeedArea, used: Set<string>, engine: Awaited<ReturnType<typeof engineForRole>>): Promise<FieldArea> {
	const out = await describeArea(area, { engine });
	const byKey = new Map(out.agendas.map((a) => [a.key, a]));
	return {
		id: uniqueId(area.title, used),
		title: area.title,
		summary: out.areaSummary,
		agendas: area.agendas.map((seed, i) => {
			const d = byKey.get(`a${i + 1}`)!;
			return {
				id: uniqueId(d.title, used),
				title: d.title,
				summary: d.summary,
				theoryOfChange: d.theoryOfChange,
				concepts: d.concepts.slice(0, 8),
				status: "active" as const,
				seedName: seed.name,
			};
		}),
	};
}

/** The map as text for the cartographer (ids + one line each). */
function mapText(areas: readonly FieldArea[]): string {
	return areas
		.map((a) => `${a.title}\n${a.agendas.map((x) => `  - [${x.id}] ${x.title}${x.status === "dormant" ? " (dormant)" : ""} — ${x.summary}`).join("\n")}`)
		.join("\n");
}

async function runRefinement(since: string, background: boolean): Promise<ProposedChange[]> {
	const engine = await engineForRole("cartographer", background, REFUSAL);
	const areas = current().areas;
	return refineMap({ mapText: mapText(areas), since, agendaIds: allAgendas(areas).map((x) => x.id) }, { engine, search: searchProvider });
}

function changeSummary(c: Pick<ProposedChange, "kind" | "agendaId" | "agenda" | "areaTitle" | "reason">, areas: readonly FieldArea[]): string {
	const name = c.agenda?.title ?? allAgendas(areas).find((x) => x.id === c.agendaId)?.title ?? c.agendaId ?? "an agenda";
	const verb = { add: `Added “${name}” to ${c.areaTitle}`, edit: `Revised “${name}”`, dormant: `Marked “${name}” dormant`, remove: `Removed “${name}”` }[c.kind];
	return `${verb} — ${c.reason}`;
}

function mergeSources(existing: FieldMapRecord["sources"], changes: readonly ProposedChange[]): FieldMapRecord["sources"] {
	const seen = new Set(existing.map((s) => s.url));
	const out = [...existing];
	for (const url of changes.flatMap((c) => c.sources)) {
		if (seen.has(url)) continue;
		seen.add(url);
		let title = url;
		try {
			title = new URL(url).hostname;
		} catch {
			// keep the raw string
		}
		out.push({ title, url });
	}
	return out;
}

// ─── updates (proposals) ─────────────────────────────────────────────────────

/** "Update the map": research changes since the last update → open proposals. */
export function updateFieldMap(): void {
	const record = current();
	if (record.status !== "ready" && record.status !== "error") throw new GoalServiceError("Build the map first", 409);
	if (record.areas.length === 0) throw new GoalServiceError("Build the map first", 409);
	startRun(
		async () => {
			save({ progress: "Researching what changed in the field", error: undefined });
			const since = (record.updatedAt ?? record.builtAt ?? SEED_DATE).slice(0, 10);
			const changes = await runRefinement(since, false);
			const now = new Date().toISOString();
			const proposals: FieldProposal[] = changes.map((c) => ({
				id: `fp_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 8)}`,
				...c,
				status: "open",
				createdAt: now,
			}));
			const r = current();
			save({
				status: "ready",
				progress: undefined,
				proposals: [...r.proposals.filter((p) => p.status !== "open"), ...proposals],
				changes: proposals.length === 0 ? [...r.changes, { at: now, summary: `Checked for changes since ${since} — nothing significant to change.` }] : r.changes,
				updatedAt: proposals.length === 0 ? now : r.updatedAt,
			});
		},
		(reason) => save({ progress: undefined, error: `The update couldn't run: ${reason}` }),
	);
}

export function resolveFieldProposal(id: string, accept: boolean): void {
	const record = current();
	const p = record.proposals.find((x) => x.id === id && x.status === "open");
	if (!p) throw new GoalServiceError("Proposal not found", 404);
	const now = new Date().toISOString();
	save({
		proposals: record.proposals.map((x) => (x.id === id ? { ...x, status: accept ? "accepted" : "rejected" } : x)),
		...(accept
			? {
					areas: applyProposal(record.areas, p),
					changes: [...record.changes, { at: now, summary: changeSummary(p, record.areas) }],
					sources: mergeSources(record.sources, [p]),
					updatedAt: now,
				}
			: {}),
	});
}

// ─── coverage ────────────────────────────────────────────────────────────────

/** Judge agenda concepts against the graph (held concepts stay held unless
 *  `all`; concepts with no candidate propositions are not-yet with no call). */
async function checkCoverage(all = false, background = true): Promise<void> {
	const record = current();
	if (record.areas.length === 0) return;
	const revision = graphRevision();
	const nodes = getGraph(stores.graphStore).nodes;
	const previous = record.coverage?.concepts ?? {};
	const next: Record<string, IdeaStatus[]> = {};
	const items: IdeaToJudge[] = [];
	for (const agenda of allAgendas(record.areas)) {
		const prior = previous[agenda.id];
		const aligned = prior && prior.length === agenda.concepts.length ? prior : null;
		next[agenda.id] = agenda.concepts.map((concept, i) => {
			if (!all && aligned?.[i] === "held") return "held";
			const candidates = ideaCandidates(concept, nodes, 8);
			if (candidates.length > 0) items.push({ key: `${agenda.id}#${i}`, idea: concept, candidates: candidates.map((n) => ({ name: n.name, statement: n.statement })) });
			return "not-yet";
		});
	}
	if (items.length > 0) {
		const engine = await engineForRole("librarian", background, REFUSAL);
		for (let i = 0; i < items.length; i += JUDGE_BATCH) {
			const judged = await judgeIdeas(items.slice(i, i + JUDGE_BATCH), { engine });
			for (const [key, status] of Object.entries(judged)) {
				const [agendaId, idx] = key.split("#") as [string, string];
				const list = next[agendaId];
				if (list) list[Number(idx)] = status;
			}
		}
	}
	const at = new Date().toISOString();
	const totals = fieldTotals(areaViews(record.areas, { graphRevision: revision, checkedAt: at, concepts: next }));
	const history = [...(current().history ?? []), { at, known: totals.known, partly: totals.partly, total: totals.total }].slice(-400);
	save({ coverage: { graphRevision: revision, checkedAt: at, concepts: next }, history });
}

function coverageStale(record: FieldMapRecord): boolean {
	return record.areas.length > 0 && (!record.coverage || record.coverage.graphRevision !== graphRevision());
}

/** Looking at the map rechecks coverage in the background when stale. */
export function ensureFieldCoverageFresh(): void {
	const record = current();
	if (record.status !== "ready" || isFieldMapWorking() || !coverageStale(record)) return;
	startRun(() => checkCoverage(), (reason) => save({ error: `Coverage couldn't be checked: ${reason}` }));
}

export function recheckFieldCoverage(): void {
	if (current().status !== "ready") throw new GoalServiceError("Build the map first", 409);
	startRun(() => checkCoverage(true, false), (reason) => save({ error: `Coverage couldn't be checked: ${reason}` }));
}

// ─── view ────────────────────────────────────────────────────────────────────

export function getFieldMapView(): FieldMapView {
	ensureFieldCoverageFresh();
	const record = current();
	return {
		status: record.status,
		...(record.progress ? { progress: record.progress } : {}),
		...(record.error ? { error: record.error } : {}),
		builtAt: record.builtAt ?? null,
		updatedAt: record.updatedAt ?? null,
		sources: record.sources,
		areas: areaViews(record.areas, record.coverage),
		proposals: record.proposals.filter((p) => p.status === "open"),
		changes: [...record.changes].reverse(),
		working: isFieldMapWorking(),
		coverageCheckedAt: record.coverage?.checkedAt ?? null,
		coverageStale: coverageStale(record),
	};
}

// ─── agenda actions ──────────────────────────────────────────────────────────

function findAgenda(agendaId: string) {
	for (const area of current().areas) {
		const agenda = area.agendas.find((x) => x.id === agendaId);
		if (agenda) return { area, agenda };
	}
	throw new GoalServiceError("Agenda not found", 404);
}

/** "Learn this agenda": a normal tailored session with the agenda context. */
export function startAgendaSession(agendaId: string): { id: string; prompt: string } {
	const { area, agenda } = findAgenda(agendaId);
	const prompt = `${agenda.title} (AI safety research agenda)`;
	const chat = stores.chatStore.createChat(prompt);
	stampStrongSlot(chat.id);
	stores.chatStore.saveMessages(chat.id, [
		newAgendaContextMessage({
			agendaId,
			agendaTitle: agenda.title,
			areaTitle: area.title,
			summary: agenda.summary,
			theoryOfChange: agenda.theoryOfChange,
			concepts: agenda.concepts,
		}),
	]);
	return { id: chat.id, prompt };
}

export function sendAgendaToRoadmap(agendaId: string, goalId: string): void {
	const { area, agenda } = findAgenda(agendaId);
	sendRoadmapMessage(
		goalId,
		`Consider adding the AI safety research agenda “${agenda.title}” (${area.title}): ${agenda.summary} Key concepts: ${agenda.concepts.join("; ")}`,
	);
}

export function agendaGoal(agendaId: string): { goalId: string } {
	const { area, agenda } = findAgenda(agendaId);
	return createGoalWithDraft(agenda.title, `Understand the AI safety research agenda “${agenda.title}” (${area.title}) well enough to follow and contribute to its work: ${agenda.summary}`);
}
