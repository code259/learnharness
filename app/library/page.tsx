import { LibraryPage } from "@/components/library-page";
import { listBookSummaries } from "@/src/server";

export const dynamic = "force-dynamic";

/** The library (fork #15): the learner's reference books. */
export default function LibraryRoute() {
	return <LibraryPage initial={listBookSummaries()} />;
}
