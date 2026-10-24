import { deleteGoal, getGoalView, goalRoute, updateGoal } from "@/src/server";

/** The roadmap page's view: derived topic statuses, sessions, estimate,
 *  conversation, open suggestions, and the agent's liveness. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const view = getGoalView(id);
	if (!view) return Response.json({ error: "Not found" }, { status: 404 });
	return Response.json(view);
}

/** Rename or change status ({ title?, status? }). */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const body = ((await req.json().catch(() => null)) ?? {}) as { title?: unknown; status?: unknown };
	return goalRoute(() => updateGoal(id, body));
}

/** Delete the goal. ?sessions=1 deletes its sessions too (graph kept);
 *  otherwise they survive, unlinked. */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const sessions = new URL(req.url).searchParams.get("sessions") === "1";
	return goalRoute(() => deleteGoal(id, { sessions }));
}
