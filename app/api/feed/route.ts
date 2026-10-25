import { ensureDailyFeedScan, getFeedView, goalRoute, refreshFeed } from "@/src/server";

/** The feed (fork #9): today's shortlist (expired/dismissed items left out). */
export async function GET() {
	return Response.json(getFeedView());
}

/** { action: "daily" } — the app shell's once-a-day gate; { action: "refresh" } — a manual scan. */
export async function POST(req: Request) {
	const body = (await req.json().catch(() => null)) as { action?: unknown } | null;
	if (body?.action === "daily") return goalRoute(() => ({ started: ensureDailyFeedScan() }));
	if (body?.action === "refresh") return goalRoute(() => refreshFeed());
	return Response.json({ error: 'action must be "daily" or "refresh"' }, { status: 400 });
}
