"use client";

import Link from "next/link";
import { MapIcon } from "lucide-react";
import type { ArtifactPartProps } from "@/src/core";

/**
 * The prober's roadmap offer, accepted (goals, fork #4): a quiet one-line
 * card linking to the new goal's roadmap page — the full map is drafted in
 * the background and appears there. While the call is in flight (or if it
 * failed) it renders a muted line instead.
 */
export function RoadmapOfferCard({ part }: ArtifactPartProps) {
	const out = part.output as { goalId?: unknown; title?: unknown; firstTopic?: unknown } | undefined;
	const goalId = typeof out?.goalId === "string" ? out.goalId : null;
	const title = typeof out?.title === "string" ? out.title : "your goal";
	const failed = part.state === "output-error";
	if (!goalId) {
		return (
			<div className="my-1 text-xs text-muted-foreground" data-testid="roadmap-offer-card">
				{failed ? "The roadmap couldn't be created." : "Creating the roadmap…"}
			</div>
		);
	}
	return (
		<Link
			href={`/goals/${goalId}`}
			data-testid="roadmap-offer-card"
			className="my-1 flex w-full max-w-2xl items-center gap-2 rounded-lg border border-dashed border-border/70 px-3 py-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
		>
			<MapIcon aria-hidden="true" className="size-3.5 shrink-0" />
			<span className="font-medium">Roadmap created</span>
			<span className="min-w-0 flex-1 truncate">
				{title} — drafting the full map; this session is its first topic
			</span>
		</Link>
	);
}
