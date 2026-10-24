"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArchiveIcon, ArchiveRestoreIcon, MapIcon, PlayIcon, PlusIcon, Trash2Icon, XIcon } from "lucide-react";
import type { GoalSummary, InboxItem, InboxView } from "@/src/core";
import { TopBar } from "@/components/top-bar";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useServerEvent, useServerResync } from "@/components/server-events";
import { timeAgo } from "@/components/sidebar";
import { cn } from "@/lib/utils";

/**
 * THE INBOX PAGE (fork #6, docs/today-inbox.md): everything captured (the
 * ⌥⌘L box, the Today panel's field, or the field here). Two tabs:
 *
 *   Inbox   — every open item: Start (a teaching session with it as the
 *             first message), Roadmap (send it to a goal's conversation),
 *             Archive
 *   Archive — archived by hand or aged out (30 days untouched): Restore, or
 *             Delete forever behind a confirm dialog
 *
 * Its own page so the Today panel stays small however big the inbox gets.
 * Refetches on inbox-changed (notify → fetch).
 */

type Post = (url: string, body?: unknown, method?: string) => Promise<Record<string, unknown> | null>;

export function InboxPage({ initial }: { initial: InboxView }) {
	const router = useRouter();
	const [view, setView] = useState<InboxView>(initial);
	const [goals, setGoals] = useState<GoalSummary[]>([]);
	const [tab, setTab] = useState<"inbox" | "archive">("inbox");
	const [error, setError] = useState<string | null>(null);
	const [deleting, setDeleting] = useState<InboxItem | null>(null);

	const refresh = useCallback(async () => {
		try {
			const [inboxRes, goalsRes] = await Promise.all([
				fetch("/api/inbox", { cache: "no-store" }),
				fetch("/api/goals", { cache: "no-store" }),
			]);
			if (inboxRes.ok) setView((await inboxRes.json()) as InboxView);
			if (goalsRes.ok) setGoals(((await goalsRes.json()) as { goals: GoalSummary[] }).goals.filter((g) => g.status === "active"));
		} catch {
			// a transient failure keeps the last view
		}
	}, []);
	useEffect(() => {
		void refresh();
	}, [refresh]);
	useServerEvent("inbox-changed", () => void refresh());
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

	const start = async (item: InboxItem) => {
		const data = await post(`/api/inbox/${item.id}`, { action: "start" });
		if (data && typeof data.id === "string") {
			router.push(`/chat/${data.id}?prompt=${encodeURIComponent(typeof data.prompt === "string" ? data.prompt : item.text)}`);
		}
	};

	const list = tab === "inbox" ? view.open : view.archived;

	return (
		<div className="flex h-dvh flex-col">
			<TopBar>
				<h1 className="min-w-0 flex-1 truncate font-title text-3xl tracking-tight">Inbox</h1>
			</TopBar>
			<div className="min-h-0 flex-1 overflow-y-auto">
				<div className="mx-auto w-full max-w-[46rem] space-y-4 px-4 py-5">
					<CaptureField post={post} />
					<div className="flex items-center gap-3">
						<div className="flex items-center gap-0.5 rounded-md border border-border/60 bg-background p-0.5" data-testid="inbox-tabs">
							{(["inbox", "archive"] as const).map((t) => (
								<button
									key={t}
									type="button"
									onClick={() => setTab(t)}
									aria-pressed={tab === t}
									data-testid={`inbox-tab-${t}`}
									className={cn(
										"rounded-sm px-3 py-1 text-[11px] uppercase tracking-wider transition-colors",
										tab === t ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground",
									)}
								>
									{t === "inbox" ? "Inbox" : "Archive"}
								</button>
							))}
						</div>
						{tab === "archive" && (
							<span className="text-xs text-muted-foreground/70">Items untouched for 30 days move here on their own.</span>
						)}
					</div>
					{error && (
						<p role="alert" className="text-xs text-red-400">
							{error}
						</p>
					)}
					{list.length === 0 ? (
						<p className="py-6 text-center text-sm text-muted-foreground">
							{tab === "inbox" ? "Nothing waiting. Press ⌥⌘L anywhere to capture something." : "The archive is empty."}
						</p>
					) : (
						<div className="space-y-2" data-testid={`inbox-list-${tab}`}>
							{list.map((item) =>
								tab === "inbox" ? (
									<InboxRow key={item.id} item={item} goals={goals} post={post} onStart={() => void start(item)} />
								) : (
									<ArchivedRow key={item.id} item={item} post={post} onDelete={() => setDeleting(item)} />
								),
							)}
						</div>
					)}
				</div>
			</div>
			<DeleteForeverDialog item={deleting} onClose={() => setDeleting(null)} post={post} />
		</div>
	);
}

/** The capture field (shared with the Today panel). */
export function CaptureField({ post, compact = false }: { post: Post; compact?: boolean }) {
	const [draft, setDraft] = useState("");
	const capture = async () => {
		const text = draft.trim();
		if (!text) return;
		setDraft("");
		if ((await post("/api/inbox", { text })) === null) setDraft(text);
	};
	return (
		<form
			onSubmit={(e) => {
				e.preventDefault();
				void capture();
			}}
			className="flex items-center gap-1.5"
		>
			<input
				value={draft}
				onChange={(e) => setDraft(e.target.value)}
				placeholder="Capture a question, link, idea…"
				aria-label="Add to inbox"
				data-testid="inbox-capture"
				className={cn(
					"lh-input min-w-0 flex-1 rounded-md border border-border bg-background px-2.5 outline-none placeholder:text-muted-foreground/60 focus:border-muted-foreground/50",
					compact ? "h-8 text-xs" : "h-10 font-prose text-sm",
				)}
			/>
			<button
				type="submit"
				aria-label="Add to inbox"
				disabled={!draft.trim()}
				className={cn(
					"flex shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40",
					compact ? "size-8" : "size-10",
				)}
			>
				<PlusIcon className="size-3.5" />
			</button>
		</form>
	);
}

export function InboxRow({ item, goals, post, onStart }: { item: InboxItem; goals: GoalSummary[]; post: Post; onStart: () => void }) {
	const [picking, setPicking] = useState(false);
	return (
		<div className="rounded-lg border border-border/70 px-3 py-2.5" data-testid="inbox-item">
			<p className="whitespace-pre-wrap font-prose text-sm leading-snug text-foreground/90">{item.text}</p>
			<div className="mt-2 flex flex-wrap items-center gap-1 text-xs">
				<span className="mr-1 text-muted-foreground/60">{timeAgo(item.touchedAt)}</span>
				<button
					type="button"
					onClick={onStart}
					className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
				>
					<PlayIcon className="size-3" /> Start
				</button>
				{goals.length > 0 && (
					<button
						type="button"
						onClick={() => setPicking((v) => !v)}
						aria-expanded={picking}
						className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
					>
						<MapIcon className="size-3" /> Roadmap
					</button>
				)}
				<button
					type="button"
					onClick={() => void post(`/api/inbox/${item.id}`, { action: "archive" })}
					className="ml-auto flex items-center gap-1 rounded-md px-1.5 py-0.5 text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground"
				>
					<ArchiveIcon className="size-3" /> Archive
				</button>
			</div>
			{picking && (
				<div className="mt-2 space-y-0.5 border-t border-border/50 pt-2 text-xs">
					<div className="flex items-center text-muted-foreground/70">
						Send to which roadmap?
						<button type="button" aria-label="Cancel" onClick={() => setPicking(false)} className="ml-auto rounded p-0.5 hover:text-foreground">
							<XIcon className="size-3" />
						</button>
					</div>
					{goals.map((g) => (
						<button
							key={g.id}
							type="button"
							onClick={async () => {
								setPicking(false);
								await post(`/api/inbox/${item.id}`, { action: "roadmap", goalId: g.id });
							}}
							className="block w-full truncate rounded-md px-1.5 py-1 text-left text-foreground/90 transition-colors hover:bg-accent"
						>
							{g.title}
						</button>
					))}
				</div>
			)}
		</div>
	);
}

function ArchivedRow({ item, post, onDelete }: { item: InboxItem; post: Post; onDelete: () => void }) {
	return (
		<div className="flex items-start gap-3 rounded-lg border border-border/50 px-3 py-2.5" data-testid="archived-item">
			<p className="min-w-0 flex-1 whitespace-pre-wrap font-prose text-sm leading-snug text-muted-foreground">{item.text}</p>
			<div className="flex shrink-0 items-center gap-1 text-xs">
				<button
					type="button"
					onClick={() => void post(`/api/inbox/${item.id}`, { action: "restore" })}
					className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
				>
					<ArchiveRestoreIcon className="size-3" /> Restore
				</button>
				<button
					type="button"
					onClick={onDelete}
					data-testid="inbox-delete"
					className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-muted-foreground/70 transition-colors hover:bg-accent hover:text-destructive"
				>
					<Trash2Icon className="size-3" /> Delete…
				</button>
			</div>
		</div>
	);
}

/** The confirm step before a permanent delete (the shared dialog). */
function DeleteForeverDialog({ item, onClose, post }: { item: InboxItem | null; onClose: () => void; post: Post }) {
	return (
		<ConfirmDialog
			open={item !== null}
			title="Delete forever?"
			subject={item?.text}
			body="This removes the item for good. It cannot be restored."
			testid="inbox-delete-dialog"
			onConfirm={async () => (item ? (await post(`/api/inbox/${item.id}`, undefined, "DELETE")) !== null : true)}
			onClose={onClose}
		/>
	);
}
