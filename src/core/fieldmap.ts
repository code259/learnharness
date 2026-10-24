/**
 * Field-map folds (fork #10 — docs/field-map.md): pure, browser-safe.
 *   - parseCsv: RFC 4180 (quoted fields, doubled quotes, newlines in quotes)
 *   - seedAreas: the Shallow Review agendas CSV → raw areas (Labs dropped)
 *   - applyProposal: one accepted change → the next areas
 *   - views + "Where you stand": concept counts per agenda/area, sorted bars
 */
import type {
	AgendaView,
	AreaView,
	ConceptCounts,
	FieldAgenda,
	FieldArea,
	FieldCoverage,
	FieldProposal,
	StandingRow,
} from "./contracts/fieldmap.ts";
import type { IdeaStatus } from "./contracts/library.ts";
import { topicSlug } from "./contracts/goals.ts";
import { sectionCoverage } from "./library.ts";

export function parseCsv(text: string): Record<string, string>[] {
	const rows: string[][] = [];
	let row: string[] = [];
	let field = "";
	let quoted = false;
	for (let i = 0; i < text.length; i++) {
		const c = text[i]!;
		if (quoted) {
			if (c === '"') {
				if (text[i + 1] === '"') {
					field += '"';
					i++;
				} else quoted = false;
			} else field += c;
		} else if (c === '"') quoted = true;
		else if (c === ",") {
			row.push(field);
			field = "";
		} else if (c === "\n" || c === "\r") {
			if (c === "\r" && text[i + 1] === "\n") i++;
			row.push(field);
			rows.push(row);
			row = [];
			field = "";
		} else field += c;
	}
	if (field !== "" || row.length > 0) {
		row.push(field);
		rows.push(row);
	}
	const [header, ...body] = rows.filter((r) => r.some((f) => f.trim() !== ""));
	if (!header) return [];
	return body.map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? "").trim()])));
}

/** The seed's raw agenda before the rewrite pass. */
export interface SeedAgenda {
	name: string;
	summary: string;
	theoryOfChange: string;
}

export interface SeedArea {
	title: string;
	agendas: SeedAgenda[];
}

const SKIP_SECTIONS = [/^labs\b/i];

/** Group the review's agendas into areas: a section whose agendas ALL have
 *  a sub-section splits into those sub-sections (Black-box safety → Iterative
 *  alignment, Model psychology, Better data, Goal robustness); otherwise the
 *  section is the area. Labs (organizations, not learning content) dropped. */
export function seedAreas(rows: readonly Record<string, string>[]): SeedArea[] {
	const bySection = new Map<string, Record<string, string>[]>();
	for (const r of rows) {
		const section = r.section ?? "";
		if (!section || !r.name || SKIP_SECTIONS.some((re) => re.test(section))) continue;
		bySection.set(section, [...(bySection.get(section) ?? []), r]);
	}
	const areas = new Map<string, SeedAgenda[]>();
	for (const [section, list] of bySection) {
		const split = list.every((r) => (r.sub_section ?? "").trim() !== "");
		for (const r of list) {
			const title = (split ? r.sub_section! : section).replace(/\s*\([^)]*\)\s*$/, "").trim();
			areas.set(title, [
				...(areas.get(title) ?? []),
				{ name: r.name!, summary: r.one_sentence_summary ?? "", theoryOfChange: r.theory_of_change ?? "" },
			]);
		}
	}
	return [...areas].map(([title, agendas]) => ({ title, agendas }));
}

export function uniqueId(base: string, used: Set<string>): string {
	const slug = topicSlug(base);
	let id = slug;
	for (let n = 2; used.has(id); n++) id = `${slug}-${n}`;
	used.add(id);
	return id;
}

export function allAgendas(areas: readonly FieldArea[]): FieldAgenda[] {
	return areas.flatMap((a) => a.agendas);
}

/** Apply one proposal (pure). add/edit name an area by title (a new title
 *  creates the area); unknown agendas make it a no-op. */
export function applyProposal(areas: readonly FieldArea[], p: Pick<FieldProposal, "kind" | "areaTitle" | "agendaId" | "agenda">): FieldArea[] {
	const next = areas.map((a) => ({ ...a, agendas: [...a.agendas] }));
	const used = new Set([...next.map((a) => a.id), ...allAgendas(next).map((g) => g.id)]);
	const find = (id: string | undefined) => {
		for (const a of next) {
			const i = a.agendas.findIndex((g) => g.id === id);
			if (i !== -1) return { area: a, i };
		}
		return null;
	};
	if (p.kind === "add" && p.agenda) {
		let area = next.find((a) => a.title.toLowerCase() === p.areaTitle.trim().toLowerCase());
		if (!area) {
			area = { id: uniqueId(p.areaTitle, used), title: p.areaTitle.trim(), summary: "", agendas: [] };
			next.push(area);
		}
		area.agendas.push({ id: uniqueId(p.agenda.title, used), ...p.agenda, concepts: p.agenda.concepts.slice(0, 8), status: "active" });
		return next;
	}
	const hit = find(p.agendaId);
	if (!hit) return next;
	const current = hit.area.agendas[hit.i]!;
	if (p.kind === "edit" && p.agenda) hit.area.agendas[hit.i] = { ...current, ...p.agenda, concepts: p.agenda.concepts.slice(0, 8) };
	else if (p.kind === "dormant") hit.area.agendas[hit.i] = { ...current, status: "dormant" };
	else if (p.kind === "remove") hit.area.agendas.splice(hit.i, 1);
	return next.filter((a) => a.agendas.length > 0);
}

function counts(statuses: readonly (IdeaStatus | undefined)[], total: number): ConceptCounts {
	let known = 0;
	let partly = 0;
	for (const s of statuses) {
		if (s === "held") known++;
		else if (s === "partly") partly++;
	}
	return { known, partly, notYet: total - known - partly, total };
}

function sum(rows: readonly ConceptCounts[]): ConceptCounts {
	return rows.reduce((t, r) => ({ known: t.known + r.known, partly: t.partly + r.partly, notYet: t.notYet + r.notYet, total: t.total + r.total }), { known: 0, partly: 0, notYet: 0, total: 0 });
}

export function areaViews(areas: readonly FieldArea[], coverage: FieldCoverage | null): AreaView[] {
	return areas.map((a) => {
		const agendas: AgendaView[] = a.agendas.map((g) => {
			const raw = coverage?.concepts[g.id];
			const aligned = raw && raw.length === g.concepts.length ? raw : null;
			return { ...g, conceptStatuses: aligned, coverage: sectionCoverage(aligned), ...counts(aligned ?? [], g.concepts.length) };
		});
		return { ...a, agendas, ...sum(agendas) };
	});
}

/** The share of concepts known (partly = half) — the bars' sort key. */
export function knownShare(c: ConceptCounts): number {
	return c.total === 0 ? 0 : (c.known + 0.5 * c.partly) / c.total;
}

/** "Where you stand": one bar per area over the whole field, or per agenda
 *  for a selection (agenda ids) or a drilled-into area. Sorted by how much
 *  is known, strongest first (ties: title). Dormant agendas are left out. */
export function standing(views: readonly AreaView[], scope: { areaId?: string; agendaIds?: ReadonlySet<string> } = {}): StandingRow[] {
	let rows: StandingRow[];
	if (scope.agendaIds && scope.agendaIds.size > 0) {
		rows = views.flatMap((a) => a.agendas).filter((g) => scope.agendaIds!.has(g.id)).map(agendaRow);
	} else if (scope.areaId) {
		rows = (views.find((a) => a.id === scope.areaId)?.agendas ?? []).filter((g) => g.status === "active").map(agendaRow);
	} else {
		rows = views.map((a) => ({ id: a.id, title: a.title, ...sum(a.agendas.filter((g) => g.status === "active")) })).filter((r) => r.total > 0);
	}
	return rows.sort((x, y) => knownShare(y) - knownShare(x) || x.title.localeCompare(y.title));
}

function agendaRow(g: AgendaView): StandingRow {
	return { id: g.id, title: g.title, known: g.known, partly: g.partly, notYet: g.notYet, total: g.total };
}

/** The field's totals (active agendas). */
export function fieldTotals(views: readonly AreaView[]): ConceptCounts {
	return sum(views.flatMap((a) => a.agendas.filter((g) => g.status === "active")));
}
