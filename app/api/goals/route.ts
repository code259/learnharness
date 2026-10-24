import { listGoalSummaries } from "@/src/server";

/** The sidebar's goal folders (goals, fork #4): derived summaries — active
 *  first, then paused, then archived. */
export async function GET() {
	return Response.json({ goals: listGoalSummaries() });
}
