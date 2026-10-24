"use client";

import Link from "next/link";
import { MapIcon } from "lucide-react";
import type { GoalContextDetails } from "@/src/core";

/**
 * The goal-context card (goals, fork #4): message[0] of a session started
 * from a roadmap topic. Scaffolding, not a turn — the graph-context card's
 * muted dashed language, one line: the topic, and a link back to the goal's
 * roadmap. The model reads the marker's own text (the roadmap status lines);
 * this card is the learner's face of it.
 */
export function GoalContextCard({ data }: { data: GoalContextDetails }) {
	return (
		<div data-testid="goal-context-card" className="my-1">
			<Link
				href={`/goals/${data.goalId}`}
				className="flex w-full items-center gap-2 rounded-lg border border-dashed border-border/70 px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:text-foreground"
			>
				<MapIcon aria-hidden="true" className="size-3.5 shrink-0" />
				<span className="font-medium">Roadmap topic</span>
				<span className="min-w-0 flex-1 truncate">
					{data.topicTitle} · part of {data.goalTitle}
				</span>
			</Link>
		</div>
	);
}
