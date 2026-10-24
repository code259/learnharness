import { goalRoute, resolveFieldProposal } from "@/src/server";

/** Accept or reject a proposed map change: { action: "accept" | "reject" }. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const body = (await req.json().catch(() => null)) as { action?: unknown } | null;
	if (body?.action !== "accept" && body?.action !== "reject") return Response.json({ error: 'action must be "accept" or "reject"' }, { status: 400 });
	const accept = body.action === "accept";
	return goalRoute(() => resolveFieldProposal(id, accept));
}
