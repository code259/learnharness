import { deleteInboxItem, goalRoute, sendInboxToRoadmap, setInboxArchived, startInboxSession } from "@/src/server";

/** Act on an inbox item: { action: "archive" | "restore" | "start" | "roadmap", goalId? }.
 *  start → { id, prompt } for /chat/<id>?prompt=. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const body = (await req.json().catch(() => null)) as { action?: unknown; goalId?: unknown } | null;
	switch (body?.action) {
		case "archive":
			return goalRoute(() => setInboxArchived(id, true));
		case "restore":
			return goalRoute(() => setInboxArchived(id, false));
		case "start":
			return goalRoute(() => startInboxSession(id));
		case "roadmap": {
			if (typeof body.goalId !== "string") return Response.json({ error: "goalId must be a string" }, { status: 400 });
			const goalId = body.goalId;
			return goalRoute(() => sendInboxToRoadmap(id, goalId));
		}
		default:
			return Response.json({ error: 'action must be "archive", "restore", "start", or "roadmap"' }, { status: 400 });
	}
}

/** Delete an ARCHIVED item for good (the archive's "Delete forever"). */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	return goalRoute(() => deleteInboxItem(id));
}
