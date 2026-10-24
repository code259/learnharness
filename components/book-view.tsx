"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRightIcon, GraduationCapIcon, MapIcon, PinIcon, PlayIcon, RefreshCwIcon, Trash2Icon, XIcon } from "lucide-react";
import type { BookView, GoalSummary, IdeaStatus, SectionCoverage, SectionView } from "@/src/core";
import { TopBar } from "@/components/top-bar";
import { BrailleSpinner } from "@/components/braille-spinner";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { coverageLine } from "@/components/library-page";
import { useServerEvent, useServerResync } from "@/components/server-events";
import { timeAgo } from "@/components/sidebar";
import { cn } from "@/lib/utils";

/**
 * A BOOK PAGE (fork #15 — docs/library.md): the book's map with what the
 * learner already knows of it, section by section — a mirror, never a
 * target. Actions:
 *   Pin to a goal       — preferred when that goal's sessions consult a book
 *   Study this book     — the opt-in book-following roadmap
 *   Learn this section  — a normal tailored session on one section
 *   Add to a roadmap    — asks a goal's roadmap agent to consider it
 *   Recheck / Delete
 * Opening the page rechecks stale coverage in the background (server-side).
 */

const DOT: Record<SectionCoverage, string> = {
	covered: "bg-foreground",
	partly: "bg-foreground/45",
	"not-yet": "border border-muted-foreground/50",
	unknown: "border border-dashed border-muted-foreground/40",
};
const LABEL: Record<SectionCoverage, string> = { covered: "Known", partly: "Partly known", "not-yet": "Not yet", unknown: "Not checked" };
const IDEA_MARK: Record<IdeaStatus, string> = { held: "✓", partly: "◐", "not-yet": "·" };

type Post = (url: string, body?: unknown, method?: string) => Promise<Record<string, unknown> | null>;

export function BookPage({ initialView }: { initialView: BookView }) {
	const router = useRouter();
	const [view, setView] = useState<BookView>(initialView);
	const [goals, setGoals] = useState<GoalSummary[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [confirmDelete, setConfirmDelete] = useState(false);
	const [pinMenu, setPinMenu] = useState(false);
	const id = initialView.id;

	const refresh = useCallback(async () => {
		try {
			const [res, goalsRes] = await Promise.all([fetch(`/api/library/${id}`, { cache: "no-store" }), fetch("/api/goals", { cache: "no-store" })]);
			if (res.status === 404) {
				router.push("/library");
				return;
			}
			if (res.ok) setView((await res.json()) as BookView);
			if (goalsRes.ok) setGoals(((await goalsRes.json()) as { goals: GoalSummary[] }).goals.filter((g) => g.status !== "archived"));
		} catch {
			// keep the last view
		}
	}, [id, router]);
	useEffect(() => {
		void refresh();
	}, [refresh]);
	useServerEvent("library-changed", () => void refresh());
	useServerEvent("goals-changed", () => void refresh());
	useServerResync(() => void refresh());

	const post: Post = useCallback(
		async (url, body, method = "POST") => {
			setError(null);
			try {
				const res = await fetch(url, {
					method,
					headers: { "Content-Type": "application/json" },
					body: body === undefined ? undefined : JSON.stringify(body),
				});
				const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
				if (!res.ok) {
					setError(typeof data.error === "string" ? data.error : `Request failed (${res.status})`);
					return null;
				}
				return data;
			} catch {
				setError("Couldn't reach the app server.");
				return null;
			} finally {
				void refresh();
			}
		},
		[refresh],
	);

	const ready = view.status === "ready";
	const pinnedIds = new Set(view.pinnedGoals.map((g) => g.id));
	const activeGoals = goals.filter((g) => g.status === "active");

	return (
		<div className="flex h-dvh flex-col">
			<TopBar>
				<h1 className="min-w-0 flex-1 truncate font-title text-3xl tracking-tight" data-testid="book-title">
					{view.title}
				</h1>
				<button
					type="button"
					aria-label="Delete book"
					onClick={() => setConfirmDelete(true)}
					className="flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
				>
					<Trash2Icon className="size-4" />
				</button>
			</TopBar>
			<div className="min-h-0 flex-1 overflow-y-auto">
				<div className="mx-auto w-full max-w-[52rem] space-y-5 px-4 py-5">
					<div className="space-y-1">
						<p className="text-sm text-muted-foreground" data-testid="book-status">
							{view.pageCount} pages · {coverageLine(view)}
							{ready && view.coverageCheckedAt && ` · checked ${timeAgo(view.coverageCheckedAt)}`}
							{ready && view.working && " · updating…"}
						</p>
						<p className="text-xs leading-relaxed text-muted-foreground/70">
							What you already know of this book, from your knowledge graph — a mirror, not a to-do list.
						</p>
					</div>

					{error && (
						<p role="alert" className="text-xs text-red-400">
							{error}
						</p>
					)}
					{view.status === "error" && (
						<div className="flex items-center gap-3 rounded-lg border border-dashed border-red-400/40 px-3 py-2 text-xs">
							<span className="min-w-0 flex-1 text-red-400">{view.error ?? "Reading the book failed."}</span>
							<ActionButton onClick={() => void post(`/api/library/${id}`, { action: "resume" })} icon={<RefreshCwIcon className="size-3" />}>
								Try again
							</ActionButton>
						</div>
					)}
					{view.status === "indexing" && (
						<div className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="book-indexing">
							{view.working ? (
								<>
									<BrailleSpinner /> {view.progress ?? "Reading the book…"}
								</>
							) : (
								<>
									Reading was interrupted.
									<ActionButton onClick={() => void post(`/api/library/${id}`, { action: "resume" })} icon={<PlayIcon className="size-3" />}>
										Resume
									</ActionButton>
								</>
							)}
						</div>
					)}

					{/* actions */}
					<div className="flex flex-wrap items-center gap-2">
						<div className="relative">
							<ActionButton onClick={() => setPinMenu((v) => !v)} icon={<PinIcon className="size-3" />}>
								Pin to a goal
							</ActionButton>
							{pinMenu && (
								<div className="absolute left-0 top-full z-20 mt-1 w-64 space-y-0.5 rounded-xl border bg-card p-2 text-xs shadow-xl">
									{activeGoals.length === 0 && <p className="px-2 py-1 text-muted-foreground">No active goals yet.</p>}
									{activeGoals.map((g) => (
										<button
											key={g.id}
											type="button"
											onClick={() => {
												setPinMenu(false);
												void post(`/api/library/${id}`, { action: pinnedIds.has(g.id) ? "unpin" : "pin", goalId: g.id });
											}}
											className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-accent"
										>
											<span className="min-w-0 flex-1 truncate">{g.title}</span>
											{pinnedIds.has(g.id) && <span className="text-muted-foreground">pinned</span>}
										</button>
									))}
								</div>
							)}
						</div>
						{view.studyGoalId ? (
							<Link href={`/goals/${view.studyGoalId}`} className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
								<GraduationCapIcon className="size-3" /> Open study roadmap
							</Link>
						) : (
							<ActionButton
								disabled={!ready}
								onClick={async () => {
									const data = await post(`/api/library/${id}`, { action: "study" });
									if (data && typeof data.goalId === "string") router.push(`/goals/${data.goalId}`);
								}}
								icon={<GraduationCapIcon className="size-3" />}
							>
								Study this book
							</ActionButton>
						)}
						<ActionButton disabled={!ready || view.working} onClick={() => void post(`/api/library/${id}`, { action: "recheck" })} icon={<RefreshCwIcon className="size-3" />}>
							Recheck coverage
						</ActionButton>
					</div>
					{view.pinnedGoals.length > 0 && (
						<div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
							Pinned to:
							{view.pinnedGoals.map((g) => (
								<span key={g.id} className="flex items-center gap-1 rounded-full border border-border/70 px-2 py-0.5">
									<Link href={`/goals/${g.id}`} className="hover:text-foreground">
										{g.title}
									</Link>
									<button type="button" aria-label={`Unpin from ${g.title}`} onClick={() => void post(`/api/library/${id}`, { action: "unpin", goalId: g.id })} className="hover:text-foreground">
										<XIcon className="size-3" />
									</button>
								</span>
							))}
						</div>
					)}

					{/* the map */}
					<div className="space-y-1" data-testid="book-chapters">
						{view.chapters.map((c) => (
							<ChapterRow key={c.id} bookId={id} chapter={c} goals={activeGoals} post={post} ready={ready} />
						))}
					</div>
				</div>
			</div>
			<ConfirmDialog
				open={confirmDelete}
				title="Delete book?"
				subject={view.title}
				body="This removes the book's copy, its map, and its coverage from your library, and unpins it from every goal. Sessions that cited it and your knowledge graph are not affected."
				testid="book-delete-dialog"
				onConfirm={async () => {
					const ok = (await post(`/api/library/${id}`, undefined, "DELETE")) !== null;
					if (ok) router.push("/library");
					return ok;
				}}
				onClose={() => setConfirmDelete(false)}
			/>
		</div>
	);
}

function ActionButton({ onClick, icon, children, disabled }: { onClick: () => void; icon: React.ReactNode; children: React.ReactNode; disabled?: boolean }) {
	return (
		<button
			type="button"
			disabled={disabled}
			onClick={onClick}
			className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
		>
			{icon} {children}
		</button>
	);
}

function ChapterRow({
	bookId,
	chapter,
	goals,
	post,
	ready,
}: {
	bookId: string;
	chapter: BookView["chapters"][number];
	goals: GoalSummary[];
	post: Post;
	ready: boolean;
}) {
	const [open, setOpen] = useState(false);
	const single = chapter.sections.length === 1;
	return (
		<div data-testid={`chapter-${chapter.id}`}>
			<button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent">
				<ChevronRightIcon className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
				<span className="min-w-0 flex-1 truncate font-prose text-(length:--lh-prose-size)">{chapter.title}</span>
				<span className="shrink-0 text-xs tabular-nums text-muted-foreground">
					{single ? LABEL[chapter.sections[0]!.coverage] : `${chapter.coveredSections}/${chapter.sections.length}`} · pp. {chapter.startPage}–{chapter.endPage}
				</span>
			</button>
			{open && (
				<div className="ml-6 space-y-0.5 border-l border-border/60 pl-2">
					{chapter.sections.map((s) => (
						<SectionRow key={s.id} bookId={bookId} section={s} goals={goals} post={post} ready={ready} />
					))}
				</div>
			)}
		</div>
	);
}

function SectionRow({ bookId, section, goals, post, ready }: { bookId: string; section: SectionView; goals: GoalSummary[]; post: Post; ready: boolean }) {
	const router = useRouter();
	const [open, setOpen] = useState(false);
	const [picking, setPicking] = useState(false);
	const [sent, setSent] = useState<string | null>(null);
	return (
		<div data-testid={`section-${section.id}`} data-coverage={section.coverage}>
			<button type="button" onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left transition-colors hover:bg-accent">
				<span className={cn("size-2 shrink-0 rounded-full", DOT[section.coverage])} title={LABEL[section.coverage]} aria-label={LABEL[section.coverage]} />
				<span className="min-w-0 flex-1 truncate text-sm">{section.title}</span>
				<span className="shrink-0 text-xs tabular-nums text-muted-foreground/70">pp. {section.startPage}–{section.endPage}</span>
			</button>
			{open && (
				<div className="ml-6 space-y-2 pb-2 pt-1 text-xs">
					{section.ideas.length > 0 ? (
						<ul className="space-y-1">
							{section.ideas.map((idea, i) => {
								const status = section.ideaStatuses?.[i];
								return (
									<li key={i} className="flex gap-2 leading-relaxed text-muted-foreground">
										<span className="w-3 shrink-0 text-center" title={status ?? "not checked"}>
											{status ? IDEA_MARK[status] : "–"}
										</span>
										<span className={cn(status === "held" && "text-foreground/85")}>{idea}</span>
									</li>
								);
							})}
						</ul>
					) : (
						<p className="text-muted-foreground/70">Key ideas not read yet.</p>
					)}
					<div className="flex flex-wrap items-center gap-1.5">
						<button
							type="button"
							disabled={!ready}
							onClick={async () => {
								const data = await post(`/api/library/${bookId}/sections/${section.id}`, { action: "learn" });
								if (data && typeof data.id === "string") router.push(`/chat/${data.id}?prompt=${encodeURIComponent(typeof data.prompt === "string" ? data.prompt : section.title)}`);
							}}
							className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
						>
							<PlayIcon className="size-3" /> Learn this section
						</button>
						{goals.length > 0 && (
							<button
								type="button"
								onClick={() => setPicking((v) => !v)}
								aria-expanded={picking}
								className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
							>
								<MapIcon className="size-3" /> Add to a roadmap
							</button>
						)}
						{sent && <span className="text-muted-foreground/70">Sent to {sent}</span>}
					</div>
					{picking && (
						<div className="space-y-0.5 border-t border-border/50 pt-1.5">
							{goals.map((g) => (
								<button
									key={g.id}
									type="button"
									onClick={async () => {
										setPicking(false);
										if ((await post(`/api/library/${bookId}/sections/${section.id}`, { action: "roadmap", goalId: g.id })) !== null) setSent(g.title);
									}}
									className="block w-full truncate rounded-md px-1.5 py-1 text-left text-foreground/90 transition-colors hover:bg-accent"
								>
									{g.title}
								</button>
							))}
						</div>
					)}
				</div>
			)}
		</div>
	);
}
