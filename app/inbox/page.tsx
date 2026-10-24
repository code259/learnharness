import { InboxPage } from "@/components/inbox-page";
import { inboxView } from "@/src/server";

export const dynamic = "force-dynamic";

/** The inbox page (fork #6): every captured item + the archive. */
export default function InboxRoute() {
	return <InboxPage initial={inboxView()} />;
}
