"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BookOpenIcon, CheckIcon, ChevronRightIcon, MoreHorizontalIcon, PlayIcon, RefreshCwIcon, SendIcon, XIcon } from "lucide-react";
import type { BookSummary, GoalStatus, GoalView, PlanNodeStatus, TopicView } from "@/src/core";
import { coverageLine } from "@/components/library-page";
import { TopBar } from "@/components/top-bar";
import { PlanDiagram, GRAPH_PAD } from "@/components/plan-block";
import { BrailleSpinner } from "@/components/braille-spinner";
import { MenuShell } from "@/components/menu-shell";
import { DeleteGoalDialog } from "@/components/delete-goal-dialog";
import { MessageResponse } from "@/components/ai-elements/message";
import { useServerEvent, useServerResync } from "@/components/server-events";
import { timeAgo } from "@/components/sidebar";
import { cn } from "@/lib/utils";

/**
 * THE ROADMAP PAGE (goals, fork #4 — docs/goals-roadmaps.md): one goal's
 * long-term map of session-sized topics.
 *
 *   left   — the goal, progress, the DAG (the plan diagram's renderer: a
 *            covered topic draws like a visited plan node, in-progress like
 *            the current one, the rest gray; the recommended next topic
 *            glows), "Next up" with Start buttons, and every topic with its
 *            sessions
 *   right  — open suggestions filed from sessions (Apply / Dismiss) and the
 *            roadmap conversation: ask the roadmap agent for changes
 *
 * Everything shown is DERIVED server-side on each fetch; the page refetches
 * on goals-changed (the agent's runs and every goal write) and on turn and
 * chat events (session progress moves topic statuses). The forgiving rules
 * hold here: no dates, no "behind" — only what is covered and what's next.
 */

const STATUS_FOR_DIAGRAM: Record<TopicView["status"], PlanNodeStatus> = {
	covered: "visited",
	"in-progress": "current",
	"not-started": "upcoming",
};

/** The recommended next topic: an in-progress available one first (pick up
 *  where he left off), else the first available in topological order. */
export function nextTopic(topics: readonly TopicView[]): TopicView | null {
	return topics.find((t) => t.available && t.status === "in-progress") ?? topics.find((t) => t.available) ?? null;
}

/** "3 of 12 topics covered · about 4 active weeks to go at your recent pace" */
export function progressLine(view: Pick<GoalView, "coveredCount" | "totalCount" | "estimate">): string {
	const base = `${view.coveredCount} of ${view.totalCount} topic${view.totalCount === 1 ? "" : "s"} covered`;
	if (!view.estimate) return base;
	const w = view.estimate.activeWeeks;
	return `${base} · about ${w} active week${w === 1 ? "" : "s"} to go at your recent pace`;
}

function statusLabel(t: TopicView): string {
	if (t.status === "covered") return "Covered";
	if (t.status === "in-progress") return "In progress";
	return t.available ? "Ready" : "Later";
}

export function GoalPage({ initialView }: { initialView: GoalView }) {
	const router = useRouter();
	const [view, setView] = useState<GoalView>(initialView);
	const [error, setError] = useState<string | null>(null);
	const [starting, setStarting] = useState<string | null>(null);
	const [renaming, setRenaming] = useState(false);
	/** Library summaries for this goal's pinned books (fork #15). */
	const [books, setBooks] = useState<BookSummary[]>([]);
	const goalId = initialView.id;

	const refresh = useCallback(async () => {
		try {
			const res = await fetch(`/api/goals/${goalId}`, { cache: "no-store" });
			if (res.status === 404) {
				router.push("/");
				return;
			}
			if (res.ok) {
				const next = (await res.json()) as GoalView;
				setView(next);
				if (next.bookIds.length > 0) {
					const lib = await fetch("/api/library", { cache: "no-store" });
					if (lib.ok) setBooks(((await lib.json()) as { books: BookSummary[] }).books.filter((b) => next.bookIds.includes(b.id)));
				} else setBooks([]);
			}
		} catch {
			// a transient failure keeps the last view
		}
	}, [goalId, router]);

	// notify → fetch, with the sidebar's 250ms trailing debounce.
	const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const schedule = useCallback(() => {
		if (debounceRef.current) clearTimeout(debounceRef.current);
		debounceRef.current = setTimeout(() => void refresh(), 250);
	}, [refresh]);
	// One fetch on mount: the server render has no book summaries (the
	// pinned-books block), and the view may have moved since render.
	useEffect(() => {
		void refresh();
	}, [refresh]);
	useServerEvent("goals-changed", schedule);
	useServerEvent("library-changed", schedule);
	useServerEvent("chats-changed", schedule);
	useServerEvent("turn-settled", schedule);
	useServerResync(() => void refresh());
	useEffect(() => () => clearTimeout(debounceRef.current), []);

	/** POST helper: surfaces the server's error text, refetches after. */
	const post = useCallback(
		async (url: string, body?: unknown, method = "POST"): Promise<unknown> => {
			setError(null);
			try {
				const res = await fetch(url, {
					method,
					headers: { "Content-Type": "application/json" },
					body: body === undefined ? undefined : JSON.stringify(body),
				});
				const data = (await res.json().catch(() => ({}))) as { error?: string };
				if (!res.ok) {
					setError(data.error ?? `Request failed (${res.status})`);
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

	const startTopic = useCallback(
		async (topicId: string) => {
			setStarting(topicId);
			const data = (await post(`/api/goals/${goalId}/topics/${topicId}/start`)) as { id?: string; prompt?: string } | null;
			setStarting(null);
			if (data?.id) router.push(`/chat/${data.id}?prompt=${encodeURIComponent(data.prompt ?? "")}`);
		},
		[goalId, post, router],
	);

	const next = useMemo(() => nextTopic(view.topics), [view.topics]);
	const available = view.topics.filter((t) => t.available);
	const drafting = view.working && view.topics.length <= 1;

	return (
		<div className="flex h-dvh flex-col">
			{/* Rename mode is interactive mode: no drag band (the chat bar's rule). */}
			<TopBar drag={!renaming}>
				{renaming ? (
					<input
						autoFocus
						defaultValue={view.title}
						aria-label="Rename goal"
						onFocus={(e) => e.currentTarget.select()}
						onBlur={(e) => {
							setRenaming(false);
							const title = e.currentTarget.value.trim();
							if (title && title !== view.title) void post(`/api/goals/${goalId}`, { title }, "PATCH");
						}}
						onKeyDown={(e) => {
							if (e.key === "Enter") e.currentTarget.blur();
							if (e.key === "Escape") {
								e.stopPropagation();
								e.currentTarget.value = view.title;
								e.currentTarget.blur();
							}
						}}
						className="min-w-0 flex-1 bg-transparent font-title text-3xl tracking-tight outline-none"
					/>
				) : (
					<button
						type="button"
						onClick={() => setRenaming(true)}
						data-testid="goal-title"
						className="-mx-1.5 min-w-0 flex-1 cursor-text truncate rounded-md px-1.5 text-left font-title text-3xl tracking-tight transition-colors hover:bg-accent"
					>
						{view.title}
					</button>
				)}
				{view.status !== "active" && (
					<span className="shrink-0 rounded-full border border-border/80 px-2 py-0.5 text-xs uppercase tracking-wide text-muted-foreground">
						{view.status}
					</span>
				)}
				<GoalMenu view={view} post={post} onRename={() => setRenaming(true)} onDeleted={() => router.push("/")} />
			</TopBar>

			<div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
				{/* ── the map ── */}
				<section className="min-w-0 flex-1 space-y-6 px-6 py-5 lg:overflow-y-auto">
					<div className="space-y-1">
						<p className="font-prose text-(length:--lh-prose-size) text-foreground/90">{view.statement}</p>
						<p className="text-xs text-muted-foreground" data-testid="goal-progress">
							{progressLine(view)}
						</p>
					</div>

					{error && (
						<p role="alert" className="text-xs text-red-400">
							{error}
						</p>
					)}
					{view.lastError && !view.working && (
						<div className="flex items-center gap-3 rounded-lg border border-dashed border-red-400/40 px-3 py-2 text-xs">
							<span className="min-w-0 flex-1 text-red-400">The roadmap agent failed: {view.lastError}</span>
							<button
								type="button"
								onClick={() => void post(`/api/goals/${goalId}/redraft`)}
								className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
							>
								<RefreshCwIcon className="size-3" /> Try again
							</button>
						</div>
					)}

					{drafting ? (
						<div className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="goal-drafting">
							<BrailleSpinner /> Drafting your roadmap — this takes a minute or two.
						</div>
					) : (
						view.topics.length > 0 && <RoadmapDiagram view={view} glowId={next?.id ?? null} />
					)}

					{books.length > 0 && (
						<div className="space-y-2" data-testid="goal-books">
							<div className="flex items-center gap-2">
								<h2 className="text-xs uppercase tracking-widest text-muted-foreground/70">Pinned books</h2>
								<button
									type="button"
									disabled={view.working || !books.some((b) => b.status === "ready")}
									onClick={() => void post(`/api/goals/${goalId}/compare`)}
									data-testid="compare-books"
									className="ml-auto flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
								>
									Compare with my roadmap
								</button>
							</div>
							{books.map((b) => (
								<Link key={b.id} href={`/library/${b.id}`} className="flex items-center gap-2 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
									<BookOpenIcon className="size-3.5 shrink-0" />
									<span className="min-w-0 flex-1 truncate text-foreground/90">{b.title}</span>
									<span className="shrink-0">{coverageLine(b)}</span>
									{b.working && <BrailleSpinner />}
								</Link>
							))}
						</div>
					)}

					{available.length > 0 && (
						<div className="space-y-2">
							<h2 className="text-xs uppercase tracking-widest text-muted-foreground/70">Next up</h2>
							<div className="grid gap-2 sm:grid-cols-2">
								{available.map((t) => (
									<div key={t.id} className="flex flex-col gap-2 rounded-lg border border-border px-3 py-2.5" data-testid={`next-topic-${t.id}`}>
										<div className="min-w-0">
											<div className="font-prose text-(length:--lh-prose-size)">{t.title}</div>
											{t.summary && <div className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{t.summary}</div>}
										</div>
										<div className="flex items-center gap-2">
											<button
												type="button"
												disabled={starting !== null}
												onClick={() => void startTopic(t.id)}
												data-testid={`start-topic-${t.id}`}
												className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs uppercase tracking-wider text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
											>
												{starting === t.id ? <BrailleSpinner /> : <PlayIcon className="size-3" />}
												{t.sessions.length > 0 ? "New session" : "Start"}
											</button>
											{t.sessions[0] && (
												<Link href={`/chat/${t.sessions[0].id}`} className="truncate text-xs text-muted-foreground hover:text-foreground">
													Continue “{t.sessions[0].title}”
												</Link>
											)}
										</div>
									</div>
								))}
							</div>
						</div>
					)}

					{view.topics.length > 0 && (
						<div className="space-y-1">
							<h2 className="text-xs uppercase tracking-widest text-muted-foreground/70">All topics</h2>
							{view.topics.map((t) => (
								<TopicRow key={t.id} topic={t} onStart={() => void startTopic(t.id)} starting={starting === t.id} />
							))}
						</div>
					)}

					{view.orphanSessions.length > 0 && (
						<div className="space-y-1">
							<h2 className="text-xs uppercase tracking-widest text-muted-foreground/70">Sessions from removed topics</h2>
							{view.orphanSessions.map((s) => (
								<Link key={s.id} href={`/chat/${s.id}`} className="block truncate rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-accent hover:text-foreground">
									{s.title}
								</Link>
							))}
						</div>
					)}
				</section>

				{/* ── suggestions + conversation ── */}
				<aside className="flex min-h-[28rem] flex-col border-t border-border lg:w-[26rem] lg:shrink-0 lg:border-t-0 lg:border-l">
					{view.suggestions.length > 0 && (
						<div className="space-y-2 border-b border-border px-4 py-3" data-testid="goal-suggestions">
							<h2 className="text-xs uppercase tracking-widest text-muted-foreground/70">Suggested changes</h2>
							{view.suggestions.map((s) => (
								<div key={s.id} className="rounded-lg border border-dashed border-border/70 px-3 py-2 text-xs">
									<p className="leading-relaxed text-foreground/90">{s.text}</p>
									<div className="mt-2 flex items-center gap-2">
										<Link
											href={s.bookId ? `/library/${s.bookId}` : `/chat/${s.chatId}`}
											className="min-w-0 flex-1 truncate text-muted-foreground hover:text-foreground"
										>
											{s.bookId ? `From ${books.find((b) => b.id === s.bookId)?.title ?? "a book"}` : "From a session"} · {timeAgo(s.createdAt)}
										</Link>
										<button
											type="button"
											disabled={view.working}
											onClick={() => void post(`/api/goals/${goalId}/suggestions/${s.id}`, { action: "apply" })}
											className="flex items-center gap-1 rounded-md px-2 py-1 text-foreground transition-colors hover:bg-accent disabled:opacity-50"
										>
											<CheckIcon className="size-3" /> Apply
										</button>
										<button
											type="button"
											onClick={() => void post(`/api/goals/${goalId}/suggestions/${s.id}`, { action: "dismiss" })}
											className="flex items-center gap-1 rounded-md px-2 py-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
										>
											<XIcon className="size-3" /> Dismiss
										</button>
									</div>
								</div>
							))}
						</div>
					)}
					<RoadmapConversation view={view} post={post} />
				</aside>
			</div>
		</div>
	);
}

function RoadmapDiagram({ view, glowId }: { view: GoalView; glowId: string | null }) {
	const markerId = useId().replace(/[^a-zA-Z0-9-]/g, "");
	const status = useMemo(() => new Map(view.topics.map((t) => [t.id, STATUS_FOR_DIAGRAM[t.status]] as const)), [view.topics]);
	const nodes = useMemo(() => view.topics.map((t) => ({ id: t.id, title: t.title })), [view.topics]);
	return (
		<div className="rounded-xl border border-border p-3" data-testid="roadmap-diagram">
			{/* Meet-fitted into a fixed band (the plan marginalia's fill mode):
			    the whole map stays in view and "Next up" stays above the fold;
			    every topic is also listed below at full size. */}
			<div className="h-[min(34rem,55vh)]">
				<PlanDiagram
					nodes={nodes}
					edges={view.edges}
					statusOf={(id) => status.get(id) ?? "upcoming"}
					glowId={glowId}
					markerId={markerId}
					pad={GRAPH_PAD + 16}
					fill
				/>
			</div>
			<p className="mt-2 text-[11px] text-muted-foreground/70">White: covered · bold: in progress · gray: not started · glow: next up</p>
		</div>
	);
}

function TopicRow({ topic, onStart, starting }: { topic: TopicView; onStart: () => void; starting: boolean }) {
	const [open, setOpen] = useState(false);
	return (
		<div data-testid={`topic-row-${topic.id}`} data-status={topic.status}>
			<button
				type="button"
				onClick={() => setOpen((v) => !v)}
				className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent"
			>
				<ChevronRightIcon className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
				<span className={cn("min-w-0 flex-1 truncate font-prose text-(length:--lh-prose-size)", topic.status === "not-started" && !topic.available && "text-muted-foreground")}>
					{topic.title}
				</span>
				<span className="shrink-0 text-xs text-muted-foreground">{statusLabel(topic)}</span>
			</button>
			{open && (
				<div className="ml-7 space-y-1.5 pb-2 text-xs">
					{topic.summary && <p className="leading-relaxed text-muted-foreground">{topic.summary}</p>}
					{topic.sessions.map((s) => (
						<Link key={s.id} href={`/chat/${s.id}`} className="flex items-center gap-2 text-muted-foreground hover:text-foreground">
							{s.covered ? <CheckIcon className="size-3" /> : <span className="size-3" />}
							<span className="truncate">{s.title}</span>
							<span className="shrink-0 text-muted-foreground/60">{timeAgo(s.updatedAt)}</span>
						</Link>
					))}
					<button
						type="button"
						disabled={starting}
						onClick={onStart}
						className="flex items-center gap-1.5 rounded-md px-1 py-0.5 uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
					>
						<PlayIcon className="size-3" /> {topic.sessions.length > 0 ? "New session on this topic" : "Start this topic"}
					</button>
				</div>
			)}
		</div>
	);
}

function RoadmapConversation({ view, post }: { view: GoalView; post: (url: string, body?: unknown) => Promise<unknown> }) {
	const [draft, setDraft] = useState("");
	const endRef = useRef<HTMLDivElement>(null);
	useEffect(() => {
		endRef.current?.scrollIntoView({ block: "end" });
	}, [view.messages.length, view.working]);
	const send = async () => {
		const text = draft.trim();
		if (!text || view.working) return;
		setDraft("");
		const ok = await post(`/api/goals/${view.id}/messages`, { text });
		if (ok === null) setDraft(text); // keep the words on failure
	};
	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3" data-testid="goal-conversation">
				<h2 className="text-xs uppercase tracking-widest text-muted-foreground/70">Roadmap conversation</h2>
				{view.messages.length === 0 && !view.working && (
					<p className="text-xs leading-relaxed text-muted-foreground">
						Ask for changes in your own words — “add more on interpretability”, “I already know linear algebra”, “split the RL topic”.
					</p>
				)}
				{view.messages.map((m) =>
					m.role === "user" ? (
						<div key={m.id} className="ml-8 rounded-lg bg-accent px-3 py-2 font-prose text-sm">
							{m.text}
						</div>
					) : (
						<div key={m.id} className="lh-prose text-sm">
							<MessageResponse>{m.text}</MessageResponse>
						</div>
					),
				)}
				{view.working && (
					<div className="flex items-center gap-2 text-xs text-muted-foreground">
						<BrailleSpinner /> Updating the roadmap…
					</div>
				)}
				<div ref={endRef} />
			</div>
			<div className="flex items-end gap-2 border-t border-border p-3">
				<textarea
					value={draft}
					onChange={(e) => setDraft(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
							e.preventDefault();
							void send();
						}
					}}
					rows={2}
					placeholder={view.working ? "The roadmap agent is working…" : "Ask for a change to the roadmap…"}
					aria-label="Message the roadmap agent"
					data-testid="goal-composer"
					className="lh-input max-h-40 min-h-10 flex-1 resize-none rounded-md border border-border bg-background px-2.5 py-2 font-prose text-sm outline-none placeholder:text-muted-foreground/60 focus:border-muted-foreground/50"
				/>
				<button
					type="button"
					onClick={() => void send()}
					disabled={view.working || draft.trim() === ""}
					aria-label="Send"
					className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
				>
					<SendIcon className="size-4" />
				</button>
			</div>
		</div>
	);
}

/** Rename · pause/resume · archive · delete. */
function GoalMenu({
	view,
	post,
	onRename,
	onDeleted,
}: {
	view: GoalView;
	post: (url: string, body?: unknown, method?: string) => Promise<unknown>;
	onRename: () => void;
	onDeleted: () => void;
}) {
	const [open, setOpen] = useState(false);
	const [confirming, setConfirming] = useState(false);
	const sessionCount = view.topics.reduce((n, t) => n + t.sessions.length, 0) + view.orphanSessions.length;
	const anchorRef = useRef<HTMLButtonElement>(null);
	useEffect(() => {
		if (!open) return;
		const onPointerDown = (e: PointerEvent) => {
			const target = e.target as Node;
			if (target instanceof Element && target.closest("[data-lh-menu]")) return;
			if (anchorRef.current?.contains(target)) return;
			setOpen(false);
		};
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.stopPropagation();
				setOpen(false);
			}
		};
		document.addEventListener("pointerdown", onPointerDown);
		document.addEventListener("keydown", onKeyDown);
		return () => {
			document.removeEventListener("pointerdown", onPointerDown);
			document.removeEventListener("keydown", onKeyDown);
		};
	}, [open]);
	const setStatus = (status: GoalStatus) => {
		setOpen(false);
		void post(`/api/goals/${view.id}`, { status }, "PATCH");
	};
	const item = "flex items-center rounded-lg px-2.5 py-1.5 text-left text-foreground transition-colors hover:bg-accent";
	return (
		<>
			<button
				ref={anchorRef}
				type="button"
				aria-label="Goal actions"
				data-testid="goal-menu"
				onClick={() => setOpen((v) => !v)}
				className="flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
			>
				<MoreHorizontalIcon className="size-4" />
			</button>
			{open && (
				<MenuShell anchorRef={anchorRef} testid="goal-menu-body" preferredSide="down" menuClass="flex w-48 flex-col gap-0.5 rounded-xl border bg-card p-2 text-xs shadow-xl">
					<button
						type="button"
						className={item}
						onClick={() => {
							setOpen(false);
							onRename();
						}}
					>
						Rename…
					</button>
					{view.status === "active" ? (
						<button type="button" className={item} onClick={() => setStatus("paused")}>
							Pause
						</button>
					) : (
						<button type="button" className={item} onClick={() => setStatus("active")}>
							{view.status === "archived" ? "Unarchive" : "Resume"}
						</button>
					)}
					{view.status !== "archived" && (
						<button type="button" className={item} onClick={() => setStatus("archived")}>
							Archive
						</button>
					)}
					<button
						type="button"
						className={item}
						onClick={() => {
							setOpen(false);
							void post(`/api/goals/${view.id}/redraft`);
						}}
					>
						Review roadmap
					</button>
					<div className="my-0.5 border-t border-border/60" aria-hidden="true" />
					<button
						type="button"
						className="flex items-center rounded-lg px-2.5 py-1.5 text-left text-muted-foreground/80 transition-colors hover:bg-accent hover:text-foreground"
						data-testid="goal-menu-delete"
						onClick={() => {
							setOpen(false);
							setConfirming(true);
						}}
					>
						Delete…
					</button>
				</MenuShell>
			)}
			<DeleteGoalDialog
				goal={confirming ? { id: view.id, title: view.title, sessionCount } : null}
				onClose={() => setConfirming(false)}
				onDeleted={() => {
					setConfirming(false);
					onDeleted();
				}}
			/>
		</>
	);
}
