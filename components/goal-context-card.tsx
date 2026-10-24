"use client";

import Link from "next/link";
import { BookOpenIcon, CompassIcon, MapIcon } from "lucide-react";
import type { AgendaContextDetails, BookContextDetails, GoalContextDetails } from "@/src/core";

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

/** The book-context card (library, fork #15): message[0] of a "Learn this
 *  section" session — the section, its pages, a link to the book page. */
export function BookContextCard({ data }: { data: BookContextDetails }) {
	return (
		<div data-testid="book-context-card" className="my-1">
			<Link
				href={`/library/${data.bookId}`}
				className="flex w-full items-center gap-2 rounded-lg border border-dashed border-border/70 px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:text-foreground"
			>
				<BookOpenIcon aria-hidden="true" className="size-3.5 shrink-0" />
				<span className="font-medium">Book section</span>
				<span className="min-w-0 flex-1 truncate">
					{data.sectionTitle} · {data.bookTitle} (pp. {data.startPage}–{data.endPage})
				</span>
			</Link>
		</div>
	);
}

/** The agenda-context card (field map, fork #10): message[0] of a "Learn
 *  this agenda" session — links back to the field map. */
export function AgendaContextCard({ data }: { data: AgendaContextDetails }) {
	return (
		<div data-testid="agenda-context-card" className="my-1">
			<Link
				href={`/field-map?agenda=${encodeURIComponent(data.agendaId)}`}
				className="flex w-full items-center gap-2 rounded-lg border border-dashed border-border/70 px-3 py-2 text-left text-xs text-muted-foreground transition-colors hover:text-foreground"
			>
				<CompassIcon aria-hidden="true" className="size-3.5 shrink-0" />
				<span className="font-medium">Research agenda</span>
				<span className="min-w-0 flex-1 truncate">
					{data.agendaTitle} · {data.areaTitle}
				</span>
			</Link>
		</div>
	);
}
