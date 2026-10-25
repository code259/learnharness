import { ProgressPage } from "@/components/progress-page";
import { getProgressView } from "@/src/server";

export const dynamic = "force-dynamic";

/** The progress page (fork #12). */
export default function ProgressRoute() {
	return <ProgressPage initialView={getProgressView()} />;
}
