import { LibraryPage } from "@/components/library-page";
import { listBookSummaries } from "@/src/server";

export const dynamic = "force-dynamic";

/** The library (forks #15, #8, #9): Books / Papers / Feed tabs (?tab=). */
export default async function LibraryRoute({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
	const { tab } = await searchParams;
	return <LibraryPage initial={listBookSummaries()} initialTab={tab === "papers" || tab === "feed" ? tab : "books"} />;
}
