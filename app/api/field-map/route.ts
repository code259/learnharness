import { buildFieldMap, getFieldMapView, goalRoute, recheckFieldCoverage, updateFieldMap } from "@/src/server";

/** The AI safety field map (fork #10): the derived view (looking at it
 *  rechecks stale coverage in the background). */
export async function GET() {
	return Response.json(getFieldMapView());
}

/** { action: "build" | "update" | "recheck" } — background runs. */
export async function POST(req: Request) {
	const body = (await req.json().catch(() => null)) as { action?: unknown } | null;
	switch (body?.action) {
		case "build":
			return goalRoute(() => buildFieldMap());
		case "update":
			return goalRoute(() => updateFieldMap());
		case "recheck":
			return goalRoute(() => recheckFieldCoverage());
		default:
			return Response.json({ error: 'action must be "build", "update", or "recheck"' }, { status: 400 });
	}
}
