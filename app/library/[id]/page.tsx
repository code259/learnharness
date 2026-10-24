import { notFound } from "next/navigation";
import { BookPage } from "@/components/book-view";
import { getBookView } from "@/src/server";

export const dynamic = "force-dynamic";

/** One book's page (fork #15): its map + what the learner already knows of it. */
export default async function BookRoute({ params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const view = getBookView(id);
	if (!view) notFound();
	return <BookPage key={view.id} initialView={view} />;
}
