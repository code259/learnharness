import { goalRoute, startTopicSession } from "@/src/server";

/** Start a session on a roadmap topic → { id, prompt }; the client opens
 *  /chat/<id>?prompt=<prompt> (the new-session contract). */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string; topicId: string }> }) {
	const { id, topicId } = await params;
	return goalRoute(() => startTopicSession(id, topicId));
}
