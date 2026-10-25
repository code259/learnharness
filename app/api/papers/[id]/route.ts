import { PAPER_DEPTHS, type PaperDepth } from "@/src/core";
import { deletePaper, getPaperView, goalRoute, startPaperSession } from "@/src/server";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const view = getPaperView(id);
	if (!view) return Response.json({ error: "Not found" }, { status: 404 });
	return Response.json(view);
}

/** { action: "read", depth } → { id, prompt } (a paper session). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const body = (await req.json().catch(() => null)) as { action?: unknown; depth?: unknown } | null;
	if (body?.action !== "read" || !PAPER_DEPTHS.includes(body.depth as PaperDepth)) {
		return Response.json({ error: 'Send { action: "read", depth: "skim" | "standard" | "deep" }' }, { status: 400 });
	}
	const depth = body.depth as PaperDepth;
	return goalRoute(() => startPaperSession(id, depth));
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	return goalRoute(() => deletePaper(id));
}
