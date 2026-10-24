/**
 * THE AI SAFETY FIELD MAP (fork #10 — docs/field-map.md). Pins:
 *   - parseCsv (quotes, doubled quotes, newlines in fields)
 *   - seedAreas: Labs dropped; a section whose agendas all have sub-sections
 *     splits into them; otherwise the section is the area
 *   - applyProposal: add (incl. a new area) / edit / dormant / remove / no-op
 *   - views + "Where you stand": per-area bars sorted strongest first, drill
 *     into an area, a ticked selection, dormant agendas left out
 *   - the service end to end with a scripted model: build (seed download →
 *     per-area rewrite → refinement applied + logged) → update (proposals) →
 *     accept / reject → agenda actions (learn / goal)
 * Isolated LH_DATA_DIR, dynamic app imports (the goals.test discipline).
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, describe, it } from "node:test";
import { createFauxCore, fauxAssistantMessage, fauxText, fauxToolCall, type FauxResponseStep } from "@earendil-works/pi-ai";

const TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "lh-fieldmap-"));
process.env.LH_DATA_DIR = TMP_DATA;

const { parseCsv, seedAreas, applyProposal, areaViews, standing, fieldTotals } = await import("../src/core/fieldmap.ts");
const { serviceEngineOverride } = await import("../src/server/agent-engines.ts");
const { fieldMapStore } = await import("../src/store/fieldmap.ts");
const { chatStore } = await import("../src/store/chats.ts");
const { goalStore } = await import("../src/store/goals.ts");
const fieldmap = await import("../src/server/fieldmap.ts");
const goals = await import("../src/server/goals.ts");

type FieldArea = import("../src/core/contracts.ts").FieldArea;
type PiEngine = import("../src/agent/models.ts").PiEngine;

after(() => {
	serviceEngineOverride.current = undefined;
	fs.rmSync(TMP_DATA, { recursive: true, force: true });
});

async function settle(isWorking: () => boolean) {
	for (let i = 0; i < 500 && isWorking(); i++) await new Promise((r) => setTimeout(r, 10));
}

const CSV = [
	"name,section,sub_section,one_sentence_summary,theory_of_change",
	'OpenAI,Labs (giant companies),,"A lab, not an agenda",',
	'Data filtering,Black-box safety (understand and control current model behaviour),Better data,"Remove harmful data, ""carefully""",Prevent dangerous capabilities',
	"Character training,Black-box safety (understand and control current model behaviour),Model psychology,Shape the persona,Personas generalize",
	'Sparse coding,White-box safety (i.e. Interpretability),,"Decompose activations\ninto features",Find features',
	"Causal abstractions,White-box safety (i.e. Interpretability),Concept-based interpretability,Abstractions,Verify mechanisms",
].join("\n");

describe("core/fieldmap — the seed", () => {
	it("parses quoted fields, doubled quotes, and newlines inside quotes", () => {
		const rows = parseCsv(CSV);
		assert.equal(rows.length, 5);
		assert.equal(rows[1]!.one_sentence_summary, 'Remove harmful data, "carefully"');
		assert.equal(rows[3]!.one_sentence_summary, "Decompose activations\ninto features");
	});

	it("groups areas: Labs dropped; all-sub-sectioned sections split; parentheticals trimmed", () => {
		const areas = seedAreas(parseCsv(CSV));
		assert.deepEqual(
			areas.map((a) => [a.title, a.agendas.map((x) => x.name)]),
			[
				["Better data", ["Data filtering"]],
				["Model psychology", ["Character training"]],
				["White-box safety", ["Sparse coding", "Causal abstractions"]],
			],
		);
	});
});

const AREAS: FieldArea[] = [
	{
		id: "interp",
		title: "Interpretability",
		summary: "",
		agendas: [
			{ id: "sae", title: "Sparse coding", summary: "s", theoryOfChange: "t", concepts: ["a", "b", "c", "d"], status: "active" },
			{ id: "old", title: "Old thing", summary: "s", theoryOfChange: "t", concepts: ["x", "y"], status: "dormant" },
		],
	},
	{ id: "control", title: "Control", summary: "", agendas: [{ id: "ctl", title: "AI control", summary: "s", theoryOfChange: "t", concepts: ["p", "q"], status: "active" }] },
];

describe("core/fieldmap — proposals and standing", () => {
	const entry = { title: "Model diffing", summary: "s", theoryOfChange: "t", concepts: ["m1", "m2", "m3"] };

	it("applies add / new area / edit / dormant / remove, and ignores unknown agendas", () => {
		let areas = applyProposal(AREAS, { kind: "add", areaTitle: "interpretability", agenda: entry });
		assert.equal(areas[0]!.agendas.at(-1)!.title, "Model diffing", "area titles match case-insensitively");
		areas = applyProposal(areas, { kind: "add", areaTitle: "Multi-agent", agenda: { ...entry, title: "Cooperative AI" } });
		assert.equal(areas.at(-1)!.title, "Multi-agent");
		areas = applyProposal(areas, { kind: "edit", areaTitle: "Control", agendaId: "ctl", agenda: { ...entry, title: "AI control (revised)" } });
		assert.equal(areas[1]!.agendas[0]!.title, "AI control (revised)");
		assert.equal(areas[1]!.agendas[0]!.id, "ctl", "edits keep the id (coverage stays attached)");
		areas = applyProposal(areas, { kind: "dormant", areaTitle: "Interpretability", agendaId: "sae" });
		assert.equal(areas[0]!.agendas[0]!.status, "dormant");
		areas = applyProposal(areas, { kind: "remove", areaTitle: "Control", agendaId: "ctl" });
		assert.equal(areas.some((a) => a.title === "Control"), false, "an emptied area disappears");
		assert.deepEqual(applyProposal(AREAS, { kind: "remove", areaTitle: "x", agendaId: "nope" }), AREAS);
	});

	it("Where you stand: area bars sorted strongest first; drill-in; selection; dormant left out", () => {
		const views = areaViews(AREAS, {
			graphRevision: 1,
			checkedAt: "",
			concepts: { sae: ["held", "partly", "not-yet", "not-yet"], old: ["held", "held"], ctl: ["held", "held"] },
		});
		const field = standing(views);
		assert.deepEqual(field.map((r) => [r.title, r.known, r.total]), [
			["Control", 2, 2],
			["Interpretability", 1, 4],
		], "dormant 'Old thing' doesn't count");
		assert.deepEqual(standing(views, { areaId: "interp" }).map((r) => r.id), ["sae"]);
		assert.deepEqual(standing(views, { agendaIds: new Set(["sae", "ctl"]) }).map((r) => r.id), ["ctl", "sae"]);
		assert.deepEqual(fieldTotals(views), { known: 3, partly: 1, notYet: 2, total: 6 });
		assert.equal(views[0]!.agendas[0]!.coverage, "partly");
	});
});

/** A scripted model that answers whichever submit tool it is offered. */
function scriptedEngine(onRefine: () => object[]): PiEngine {
	const faux = createFauxCore({ tokenSize: { min: 64, max: 64 } });
	const respond = ((context: { messages: unknown[] }) => {
		// The faux context carries messages only — dispatch on the prompt.
		const text = JSON.stringify(context.messages);
		const answered = text.includes('"toolResult"') || text.includes("toolCallId");
		if (text.includes("Area: ") && !answered) {
			const keys = [...text.matchAll(/\[(a\d+)\] ([^\\]+)/g)].map((m) => ({ key: m[1]!, name: m[2]! }));
			return fauxAssistantMessage([
				fauxToolCall("submit_area", {
					areaSummary: "An area of the field.",
					agendas: keys.map((k) => ({ key: k.key, title: k.name, summary: `About ${k.name}.`, theoryOfChange: "It helps.", concepts: ["One idea", "Two idea", "Three idea"] })),
				}),
			]);
		}
		if (text.includes("Changes since:") && !answered) return fauxAssistantMessage([fauxToolCall("submit_changes", { changes: onRefine() } as never)]);
		return fauxAssistantMessage([fauxText("Drafted.")]); // the roadmap agent (Make it a goal)
	}) as unknown as FauxResponseStep;
	faux.setResponses(Array.from({ length: 64 }, () => respond));
	return { model: faux.getModel(), streamFn: faux.streamSimple } as unknown as PiEngine;
}

describe("server/fieldmap — build, update, act", () => {
	it("builds: seed → areas in its own words → the first refinement applied and logged", async () => {
		fieldmap.seedFetch.current = async () => CSV;
		serviceEngineOverride.current = scriptedEngine(() => [
			{
				kind: "add",
				areaTitle: "White-box safety",
				agenda: { title: "Model diffing", summary: "Compare models.", theoryOfChange: "Spot changes.", concepts: ["Diffs", "Crosscoders", "Fine-tune effects"] },
				reason: "Grew substantially in 2026.",
				sources: ["https://example.org/diffing"],
			},
		]);
		assert.equal(fieldmap.getFieldMapView().status, "empty");
		fieldmap.buildFieldMap();
		await settle(() => fieldmap.isFieldMapWorking());
		const view = fieldmap.getFieldMapView();
		assert.equal(view.status, "ready", view.error);
		assert.deepEqual(view.areas.map((a) => a.title), ["Better data", "Model psychology", "White-box safety"]);
		const whiteBox = view.areas[2]!;
		assert.deepEqual(whiteBox.agendas.map((x) => x.title), ["Sparse coding", "Causal abstractions", "Model diffing"]);
		assert.equal(whiteBox.agendas[0]!.seedName, "Sparse coding");
		assert.equal(whiteBox.agendas[0]!.summary, "About Sparse coding.", "the rewrite, not the seed's text");
		assert.match(view.changes[0]!.summary, /Added “Model diffing”/);
		assert.ok(view.sources.some((s) => s.url === "https://shallowreview.ai"));
		assert.ok(view.sources.some((s) => s.url === "https://example.org/diffing"));
		assert.ok(fieldMapStore.read()!.coverage, "a first coverage pass ran (empty graph: all not-yet)");
	});

	it("updates as proposals; accept applies + logs, reject leaves the map", async () => {
		const target = fieldmap.getFieldMapView().areas[0]!.agendas[0]!;
		serviceEngineOverride.current = scriptedEngine(() => [
			{ kind: "dormant", areaTitle: "Better data", agendaId: target.id, reason: "No activity in a year.", sources: [] },
			{ kind: "remove", areaTitle: "Model psychology", agendaId: fieldmap.getFieldMapView().areas[1]!.agendas[0]!.id, reason: "Duplicate.", sources: [] },
		]);
		fieldmap.updateFieldMap();
		await settle(() => fieldmap.isFieldMapWorking());
		const proposals = fieldmap.getFieldMapView().proposals;
		assert.equal(proposals.length, 2);
		assert.equal(fieldmap.getFieldMapView().areas[0]!.agendas[0]!.status, "active", "proposals never apply on their own");
		fieldmap.resolveFieldProposal(proposals[0]!.id, true);
		fieldmap.resolveFieldProposal(proposals[1]!.id, false);
		const after = fieldmap.getFieldMapView();
		assert.equal(after.areas[0]!.agendas[0]!.status, "dormant");
		assert.equal(after.areas.length, 3, "the rejected removal changed nothing");
		assert.equal(after.proposals.length, 0);
		assert.match(after.changes[0]!.summary, /Marked “.*” dormant/);
		assert.throws(() => fieldmap.resolveFieldProposal(proposals[0]!.id, true), /not found/);
	});

	it("Learn this agenda: a normal session opening with the agenda context; Make it a goal drafts a roadmap", async () => {
		const agenda = fieldmap.getFieldMapView().areas[2]!.agendas[0]!;
		const { id, prompt } = fieldmap.startAgendaSession(agenda.id);
		assert.match(prompt, /Sparse coding/);
		const marker = chatStore.getChat(id)!.messages[0] as unknown as { customType: string; content: string };
		assert.equal(marker.customType, "agenda-context");
		assert.match(marker.content, /orientation, not a syllabus/);
		const { goalId } = fieldmap.agendaGoal(agenda.id);
		await settle(() => goals.isRoadmapRunning(goalId));
		assert.equal(goalStore.getGoal(goalId)!.title, "Sparse coding");
		assert.throws(() => fieldmap.startAgendaSession("nope"), /Agenda not found/);
	});
});
