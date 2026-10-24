import { deleteBook, getBookView, goalRoute, recheckCoverage, setBookPinned, startIndex, studyBook } from "@/src/server";

/** The book page's view (opening it rechecks stale coverage in the background). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const view = getBookView(id);
	if (!view) return Response.json({ error: "Not found" }, { status: 404 });
	return Response.json(view);
}

/** Book actions: { action: "pin" | "unpin", goalId } | { action: "recheck" | "resume" | "study" }. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const body = (await req.json().catch(() => null)) as { action?: unknown; goalId?: unknown } | null;
	switch (body?.action) {
		case "pin":
		case "unpin": {
			if (typeof body.goalId !== "string") return Response.json({ error: "goalId must be a string" }, { status: 400 });
			const goalId = body.goalId;
			const pinned = body.action === "pin";
			return goalRoute(() => setBookPinned(id, goalId, pinned));
		}
		case "recheck":
			return goalRoute(() => recheckCoverage(id));
		case "resume":
			return goalRoute(() => ({ started: startIndex(id) }));
		case "study":
			return goalRoute(() => studyBook(id));
		default:
			return Response.json({ error: 'action must be "pin", "unpin", "recheck", "resume", or "study"' }, { status: 400 });
	}
}

/** Delete the book (its PDF copy and map); unpins it everywhere. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	return goalRoute(() => deleteBook(id));
}
