import { goalRoute, sendRoadmapMessage } from "@/src/server";

/** The roadmap-page composer: records the message and starts the roadmap
 *  agent (fire-and-forget — the page follows goals-changed). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const body = (await req.json().catch(() => null)) as { text?: unknown } | null;
	if (typeof body?.text !== "string") return Response.json({ error: "text must be a string" }, { status: 400 });
	const text = body.text;
	return goalRoute(() => sendRoadmapMessage(id, text));
}
