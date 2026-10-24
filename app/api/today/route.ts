import { parseBudget, todayPlan } from "@/src/server";

/** The Today plan (fork #2/#5): derived fresh for ?budget=15|30|60|120. */
export async function GET(req: Request) {
	return Response.json(todayPlan(parseBudget(new URL(req.url).searchParams.get("budget"))));
}
