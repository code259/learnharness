import { agendaGoal, goalRoute, sendAgendaToRoadmap, startAgendaSession } from "@/src/server";

/** Agenda actions: { action: "learn" } → { id, prompt } | { action: "roadmap", goalId } | { action: "goal" } → { goalId }. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const body = (await req.json().catch(() => null)) as { action?: unknown; goalId?: unknown } | null;
	switch (body?.action) {
		case "learn":
			return goalRoute(() => startAgendaSession(id));
		case "goal":
			return goalRoute(() => agendaGoal(id));
		case "roadmap": {
			if (typeof body.goalId !== "string") return Response.json({ error: "goalId must be a string" }, { status: 400 });
			const goalId = body.goalId;
			return goalRoute(() => sendAgendaToRoadmap(id, goalId));
		}
		default:
			return Response.json({ error: 'action must be "learn", "roadmap", or "goal"' }, { status: 400 });
	}
}
