import { goalRoute, resolveSuggestion } from "@/src/server";

/** Apply ({ action: "apply" } — the roadmap agent revises) or dismiss. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string; suggestionId: string }> }) {
	const { id, suggestionId } = await params;
	const body = (await req.json().catch(() => null)) as { action?: unknown } | null;
	if (body?.action !== "apply" && body?.action !== "dismiss") {
		return Response.json({ error: 'action must be "apply" or "dismiss"' }, { status: 400 });
	}
	const action = body.action;
	return goalRoute(() => resolveSuggestion(id, suggestionId, action));
}
