"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExternalLinkIcon, FileTextIcon, InboxIcon, LinkIcon, PlusIcon, RefreshCwIcon, UploadIcon, XIcon } from "lucide-react";
import { PAPER_DEPTHS, type CalibrationBand, type FeedView, type PaperDepth, type PaperSummary } from "@/src/core";
import { BrailleSpinner } from "@/components/braille-spinner";
import { useServerEvent, useServerResync } from "@/components/server-events";
import { timeAgo } from "@/components/sidebar";
import { cn } from "@/lib/utils";

/**
 * The Library's Papers + Feed tabs (forks #8, #9 — docs/papers-feed.md).
 *   Papers — add (arXiv id/link, PDF/article link, PDF file), the shelf, and
 *            "Your predictions": hit rate per confidence band
 *   Feed   — today's shortlist (top 5, 7-day window, nothing counted) with
 *            Read it (pick a depth) / Add to papers / Capture / Dismiss
 */

type Post = (url: string, body?: unknown) => Promise<Record<string, unknown> | null>;

function usePost(onDone: () => void): { post: Post; error: string | null } {
	const [error, setError] = useState<string | null>(null);
	const post: Post = useCallback(
		async (url, body) => {
			setError(null);
			try {
				const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
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
				onDone();
			}
		},
		[onDone],
	);
	return { post, error };
}

/** Skim / Standard / Deep — starts a paper session at that depth. */
export function DepthPicker({ onPick, busy }: { onPick: (depth: PaperDepth) => void; busy?: boolean }) {
	return (
		<span className="inline-flex items-center gap-0.5 rounded-md border border-border/70 p-0.5" data-testid="depth-picker">
			<span className="px-1.5 text-[11px] text-muted-foreground">Read it:</span>
			{PAPER_DEPTHS.map((d) => (
				<button
					key={d}
					type="button"
					disabled={busy}
					onClick={() => onPick(d)}
					className="rounded-sm px-2 py-0.5 text-[11px] capitalize text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
				>
					{d}
				</button>
			))}
		</span>
	);
}

/** Open a freshly created session with its first message. */
function useOpenSession() {
	const router = useRouter();
	return (data: Record<string, unknown> | null) => {
		if (data && typeof data.id === "string") router.push(`/chat/${data.id}?prompt=${encodeURIComponent(typeof data.prompt === "string" ? data.prompt : "")}`);
	};
}

// ─── Papers ──────────────────────────────────────────────────────────────────

export function PapersTab() {
	const [papers, setPapers] = useState<PaperSummary[] | null>(null);
	const [bands, setBands] = useState<CalibrationBand[]>([]);
	const [open, setOpen] = useState(0);
	const [ref, setRef] = useState("");
	const [busy, setBusy] = useState(false);
	const fileRef = useRef<HTMLInputElement>(null);
	const refresh = useCallback(async () => {
		try {
			const res = await fetch("/api/papers", { cache: "no-store" });
			if (!res.ok) return;
			const data = (await res.json()) as { papers: PaperSummary[]; calibration: { bands: CalibrationBand[]; open: number } };
			setPapers(data.papers);
			setBands(data.calibration.bands);
			setOpen(data.calibration.open);
		} catch {
			// keep the last view
		}
	}, []);
	useEffect(() => {
		void refresh();
	}, [refresh]);
	useServerEvent("papers-changed", () => void refresh());
	useServerResync(() => void refresh());
	const { post, error } = usePost(() => void refresh());
	const [uploadError, setUploadError] = useState<string | null>(null);

	const addRef = async () => {
		if (!ref.trim()) return;
		setBusy(true);
		if ((await post("/api/papers", { ref: ref.trim() })) !== null) setRef("");
		setBusy(false);
	};

	return (
		<div className="space-y-5">
			<div className="space-y-2 rounded-xl border border-border p-3" data-testid="papers-add">
				<form
					className="flex items-center gap-1.5"
					onSubmit={(e) => {
						e.preventDefault();
						void addRef();
					}}
				>
					<input
						value={ref}
						onChange={(e) => setRef(e.target.value)}
						placeholder="arXiv link or id, or a PDF / article link…"
						aria-label="Paper link or arXiv id"
						className="lh-input h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-xs outline-none placeholder:text-muted-foreground/60 focus:border-muted-foreground/50"
					/>
					<button type="submit" disabled={busy || !ref.trim()} aria-label="Add paper" className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40">
						<LinkIcon className="size-3.5" />
					</button>
					<span className="text-xs text-muted-foreground/60">or</span>
					<input
						ref={fileRef}
						type="file"
						accept="application/pdf,.pdf"
						className="hidden"
						onChange={async (e) => {
							const file = e.target.files?.[0];
							e.target.value = "";
							if (!file) return;
							setBusy(true);
							setUploadError(null);
							const form = new FormData();
							form.append("file", file);
							try {
								const res = await fetch("/api/papers", { method: "POST", body: form });
								if (!res.ok) setUploadError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Upload failed");
							} catch {
								setUploadError("Couldn't reach the app server.");
							} finally {
								setBusy(false);
								void refresh();
							}
						}}
					/>
					<button type="button" disabled={busy} onClick={() => fileRef.current?.click()} className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50">
						<UploadIcon className="size-3.5" /> PDF…
					</button>
				</form>
				{busy && (
					<div className="flex items-center gap-2 text-xs text-muted-foreground">
						<BrailleSpinner /> Adding the paper…
					</div>
				)}
				{(error || uploadError) && (
					<p role="alert" className="text-xs text-red-400">
						{error ?? uploadError}
					</p>
				)}
			</div>

			{papers === null ? null : papers.length === 0 ? (
				<p className="py-4 text-center text-sm text-muted-foreground">No papers yet — add one above, or pick one from the Feed.</p>
			) : (
				<div className="space-y-2" data-testid="papers-list">
					{papers.map((p) => (
						<Link key={p.id} href={`/library/papers/${p.id}`} className="flex items-center gap-3 rounded-lg border border-border/70 px-3 py-2.5 transition-colors hover:bg-accent">
							<FileTextIcon className="size-4 shrink-0 text-muted-foreground" />
							<span className="min-w-0 flex-1">
								<span className="block truncate font-prose text-sm">{p.title}</span>
								<span className="block truncate text-xs text-muted-foreground">
									{p.authors.slice(0, 3).join(", ")}
									{p.authors.length > 3 ? " et al." : ""}
									{p.arxivId ? ` · arXiv ${p.arxivId}` : ""}
									{p.sessions > 0 ? ` · ${p.sessions} session${p.sessions === 1 ? "" : "s"}` : ""}
								</span>
							</span>
						</Link>
					))}
				</div>
			)}

			<CalibrationView bands={bands} open={open} />
		</div>
	);
}

/** "Your predictions": hit rate per confidence band — are your 70% calls
 *  right about 70% of the time? */
export function CalibrationView({ bands, open }: { bands: CalibrationBand[]; open: number }) {
	const total = bands.reduce((n, b) => n + b.calls, 0);
	return (
		<section className="space-y-2 rounded-xl border border-border p-4" data-testid="calibration">
			<h2 className="text-xs uppercase tracking-widest text-muted-foreground">Your predictions</h2>
			{total === 0 ? (
				<p className="text-xs leading-relaxed text-muted-foreground">
					In Standard and Deep paper sessions you predict the results before seeing them, with a confidence. Once some are resolved, this shows whether your
					confident calls are right as often as you expect.
				</p>
			) : (
				<div className="space-y-1.5">
					{bands
						.filter((b) => b.calls > 0)
						.map((b) => (
							<div key={b.label} className="grid grid-cols-[4.5rem_1fr_7rem] items-center gap-3 text-xs">
								<span className="tabular-nums text-muted-foreground">{b.label}</span>
								<div className="relative h-2 overflow-hidden rounded-full border border-border/70">
									<div className="h-full bg-foreground" style={{ width: `${Math.round((b.hitRate ?? 0) * 100)}%` }} />
									{/* where a perfectly calibrated hit rate would sit (the band's middle) */}
									<div className="absolute top-0 h-full w-px bg-muted-foreground" style={{ left: `${(b.low + b.high) / 2}%` }} />
								</div>
								<span className="tabular-nums text-muted-foreground">
									{Math.round((b.hitRate ?? 0) * 100)}% right · {b.calls} call{b.calls === 1 ? "" : "s"}
								</span>
							</div>
						))}
					<p className="text-[11px] text-muted-foreground/70">The tick marks where a calibrated hit rate would be.{open > 0 ? ` ${open} still unresolved.` : ""}</p>
				</div>
			)}
		</section>
	);
}

// ─── Feed ────────────────────────────────────────────────────────────────────

export function FeedTab() {
	const [view, setView] = useState<FeedView | null>(null);
	const [busy, setBusy] = useState<string | null>(null);
	const openSession = useOpenSession();
	const refresh = useCallback(async () => {
		try {
			const res = await fetch("/api/feed", { cache: "no-store" });
			if (res.ok) setView((await res.json()) as FeedView);
		} catch {
			// keep the last view
		}
	}, []);
	useEffect(() => {
		void refresh();
	}, [refresh]);
	useServerEvent("papers-changed", () => void refresh());
	useServerResync(() => void refresh());
	const { post, error } = usePost(() => void refresh());

	const act = async (id: string, body: Record<string, unknown>) => {
		setBusy(id);
		const data = await post(`/api/feed/${id}`, body);
		setBusy(null);
		return data;
	};

	return (
		<div className="space-y-4">
			<div className="flex items-center gap-2 text-xs text-muted-foreground">
				<span className="min-w-0 flex-1">
					New papers and lab research picked for you, once a day.{view?.lastScanAt ? ` Last checked ${timeAgo(view.lastScanAt)}.` : ""}
				</span>
				<button
					type="button"
					disabled={view?.working}
					onClick={() => void post("/api/feed", { action: "refresh" })}
					className="flex shrink-0 items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
				>
					{view?.working ? <BrailleSpinner /> : <RefreshCwIcon className="size-3" />} Refresh
				</button>
			</div>
			{error && (
				<p role="alert" className="text-xs text-red-400">
					{error}
				</p>
			)}
			{view?.error && <p className="text-xs text-muted-foreground/80">{view.error}</p>}
			{view && view.items.length === 0 && !view.working && <p className="py-4 text-center text-sm text-muted-foreground">Nothing picked yet — try Refresh.</p>}
			<div className="space-y-2" data-testid="feed-items">
				{view?.items.map((item) => (
					<article key={item.id} className="rounded-lg border border-border/70 px-3 py-2.5" data-testid="feed-item">
						<div className="flex items-start gap-2">
							<div className="min-w-0 flex-1">
								<a href={item.url} target="_blank" rel="noreferrer" className="font-prose text-sm text-foreground hover:underline">
									{item.title}
								</a>
								<div className="text-[11px] text-muted-foreground">
									{item.source} · {item.publishedAt.slice(0, 10)}
								</div>
							</div>
							<button type="button" aria-label="Dismiss" onClick={() => void act(item.id, { action: "dismiss" })} className="rounded-md p-1 text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground">
								<XIcon className="size-3.5" />
							</button>
						</div>
						{item.summary && <p className="mt-1 text-xs leading-relaxed text-foreground/85">{item.summary}</p>}
						{item.why && <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">Why for you: {item.why}</p>}
						<div className="mt-2 flex flex-wrap items-center gap-1.5">
							<DepthPicker busy={busy === item.id} onPick={async (depth) => openSession(await act(item.id, { action: "read", depth }))} />
							{item.paperId ? (
								<Link href={`/library/papers/${item.paperId}`} className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground">
									<ExternalLinkIcon className="size-3" /> On your shelf
								</Link>
							) : (
								<button type="button" disabled={busy === item.id} onClick={() => void act(item.id, { action: "add" })} className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40">
									<PlusIcon className="size-3" /> Add to papers
								</button>
							)}
							<button type="button" onClick={() => void act(item.id, { action: "capture" })} className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
								<InboxIcon className="size-3" /> Capture
							</button>
							{busy === item.id && <BrailleSpinner />}
						</div>
					</article>
				))}
			</div>
		</div>
	);
}

/** The once-a-day feed gate (mounted once in the app shell): the server
 *  decides whether today's scan already ran. */
export function DailyFeedScan() {
	useEffect(() => {
		void fetch("/api/feed", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "daily" }) }).catch(() => {});
	}, []);
	return null;
}

export const libraryTabClass = (active: boolean) =>
	cn("rounded-sm px-3 py-1 text-[11px] uppercase tracking-wider transition-colors", active ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground");
