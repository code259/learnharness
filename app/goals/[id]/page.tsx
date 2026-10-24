import { notFound } from "next/navigation";
import { GoalPage } from "@/components/goal-view";
import { getGoalView } from "@/src/server";

export const dynamic = "force-dynamic";

/** One goal's roadmap page (goals, fork #4). The view is derived server-side
 *  (topic statuses fold from the linked sessions); the client refetches on
 *  goals/turn/chat events. */
export default async function GoalRoute({ params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const view = getGoalView(id);
	if (!view) notFound();
	return <GoalPage key={view.id} initialView={view} />;
}
