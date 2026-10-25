import { notFound } from "next/navigation";
import { PaperPage } from "@/components/paper-view";
import { getPaperView } from "@/src/server";

export const dynamic = "force-dynamic";

/** One paper's page (fork #8). */
export default async function PaperRoute({ params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const view = getPaperView(id);
	if (!view) notFound();
	return <PaperPage key={view.id} initialView={view} />;
}
