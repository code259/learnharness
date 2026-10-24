import { compareWithBooks, goalRoute } from "@/src/server";

/** "Compare with my roadmap": the roadmap agent files suggestions from the
 *  goal's pinned books (it cannot rewrite the roadmap). */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	return goalRoute(() => compareWithBooks(id));
}
