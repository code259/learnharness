import { goalRoute, sendSectionToRoadmap, startSectionSession } from "@/src/server";

/** Section actions: { action: "learn" } → { id, prompt } (a "Learn this
 *  section" session) | { action: "roadmap", goalId }. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string; sectionId: string }> }) {
	const { id, sectionId } = await params;
	const body = (await req.json().catch(() => null)) as { action?: unknown; goalId?: unknown } | null;
	if (body?.action === "learn") return goalRoute(() => startSectionSession(id, sectionId));
	if (body?.action === "roadmap") {
		if (typeof body.goalId !== "string") return Response.json({ error: "goalId must be a string" }, { status: 400 });
		const goalId = body.goalId;
		return goalRoute(() => sendSectionToRoadmap(id, sectionId, goalId));
	}
	return Response.json({ error: 'action must be "learn" or "roadmap"' }, { status: 400 });
}
