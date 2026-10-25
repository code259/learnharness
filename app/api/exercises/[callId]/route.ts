import { getExerciseMark, goalRoute, markExercise } from "@/src/server";

/** An exercise card's mark (fork #11), or null. */
export async function GET(_req: Request, { params }: { params: Promise<{ callId: string }> }) {
	const { callId } = await params;
	return Response.json({ mark: getExerciseMark(callId) });
}

/** Mark it: { chatId, status: "done" | "struggled", note? }. */
export async function POST(req: Request, { params }: { params: Promise<{ callId: string }> }) {
	const { callId } = await params;
	const body = (await req.json().catch(() => null)) as { chatId?: unknown; status?: unknown; note?: unknown } | null;
	if (typeof body?.chatId !== "string" || (body.status !== "done" && body.status !== "struggled")) {
		return Response.json({ error: 'Send { chatId, status: "done" | "struggled", note? }' }, { status: 400 });
	}
	const { chatId, status } = body as { chatId: string; status: "done" | "struggled" };
	const note = typeof body.note === "string" ? body.note : undefined;
	return goalRoute(() => ({ mark: markExercise(chatId, callId, status, note) }));
}
