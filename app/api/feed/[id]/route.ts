import { PAPER_DEPTHS, type PaperDepth } from "@/src/core";
import { addFeedItemToPapers, captureFeedItem, dismissFeedItem, goalRoute, readFeedItem } from "@/src/server";

/** Feed item actions: { action: "read", depth } → { id, prompt } | "add" | "capture" | "dismiss". */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const body = (await req.json().catch(() => null)) as { action?: unknown; depth?: unknown } | null;
	switch (body?.action) {
		case "read": {
			if (!PAPER_DEPTHS.includes(body.depth as PaperDepth)) return Response.json({ error: "depth must be skim, standard, or deep" }, { status: 400 });
			const depth = body.depth as PaperDepth;
			return goalRoute(() => readFeedItem(id, depth));
		}
		case "add":
			return goalRoute(async () => ({ paperId: (await addFeedItemToPapers(id)).id }));
		case "capture":
			return goalRoute(() => captureFeedItem(id));
		case "dismiss":
			return goalRoute(() => dismissFeedItem(id));
		default:
			return Response.json({ error: 'action must be "read", "add", "capture", or "dismiss"' }, { status: 400 });
	}
}
