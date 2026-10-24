import { captureInboxItem, goalRoute, inboxView } from "@/src/server";

/** The inbox (fork #6): open items + the archive (by hand or aged out). */
export async function GET() {
	return Response.json(inboxView());
}

/** Capture ({ text }) — the ⌥⌘L box and the Today panel's field. */
export async function POST(req: Request) {
	const body = (await req.json().catch(() => null)) as { text?: unknown } | null;
	if (typeof body?.text !== "string") return Response.json({ error: "text must be a string" }, { status: 400 });
	const text = body.text;
	return goalRoute(() => captureInboxItem(text));
}
