import { goalRoute, redraftRoadmap } from "@/src/server";

/** Retry the draft (after a failed run) or ask for a review pass. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	return goalRoute(() => redraftRoadmap(id));
}
