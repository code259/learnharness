import { getProgressView } from "@/src/server";

/** The progress page's view (fork #12) — all derived. */
export async function GET() {
	return Response.json(getProgressView());
}
