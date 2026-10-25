"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { BookOpenIcon, LinkIcon, UploadIcon } from "lucide-react";
import type { BookSummary } from "@/src/core";
import { TopBar } from "@/components/top-bar";
import { FeedTab, PapersTab, libraryTabClass } from "@/components/papers-feed";
import { BrailleSpinner } from "@/components/braille-spinner";
import { useServerEvent, useServerResync } from "@/components/server-events";

/**
 * THE LIBRARY (fork #15 — docs/library.md): the learner's reference books.
 * Add a PDF (a file, copied into the library, or a link, downloaded once);
 * the map is built in the background. Books are references and yardsticks,
 * never the curriculum — the page says so where it matters.
 */

/** "12 of 40 sections known" — a mirror, never a target. */
export function coverageLine(b: Pick<BookSummary, "status" | "coveredSections" | "totalSections" | "progress" | "working">): string {
	if (b.status === "indexing") return b.working ? (b.progress ?? "Reading…") : "Paused — open to resume";
	if (b.status === "error") return "Couldn't finish reading";
	return `${b.coveredSections} of ${b.totalSections} sections known`;
}

export type LibraryTab = "books" | "papers" | "feed";

export function LibraryPage({ initial, initialTab = "books" }: { initial: BookSummary[]; initialTab?: LibraryTab }) {
	const [tab, setTab] = useState<LibraryTab>(initialTab);
	const pickTab = (t: LibraryTab) => {
		setTab(t);
		window.history.replaceState(null, "", t === "books" ? "/library" : `/library?tab=${t}`);
	};
	const [books, setBooks] = useState<BookSummary[]>(initial);
	const [url, setUrl] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const fileRef = useRef<HTMLInputElement>(null);

	const refresh = useCallback(async () => {
		try {
			const res = await fetch("/api/library", { cache: "no-store" });
			if (res.ok) setBooks(((await res.json()) as { books: BookSummary[] }).books);
		} catch {
			// keep the last view
		}
	}, []);
	useServerEvent("library-changed", () => void refresh());
	useServerEvent("goals-changed", () => void refresh());
	useServerResync(() => void refresh());

	const add = async (init: RequestInit) => {
		setBusy(true);
		setError(null);
		try {
			const res = await fetch("/api/library", { method: "POST", ...init });
			const body = (await res.json().catch(() => ({}))) as { error?: string };
			if (!res.ok) setError(body.error ?? `Couldn't add the book (${res.status})`);
			else setUrl("");
		} catch {
			setError("Couldn't reach the app server.");
		} finally {
			setBusy(false);
			void refresh();
		}
	};

	return (
		<div className="flex h-dvh flex-col">
			<TopBar>
				<h1 className="min-w-0 flex-1 truncate font-title text-3xl tracking-tight">Library</h1>
			</TopBar>
			<div className="min-h-0 flex-1 overflow-y-auto">
				<div className="mx-auto w-full max-w-[46rem] space-y-5 px-4 py-5">
					<p className="text-sm leading-relaxed text-muted-foreground">
						Reference books for your learning. Sessions consult them when it helps and cite them; each book shows how much of it you
						already know. They never set your roadmap — unless you choose <em>Study this book</em>.
					</p>

					<div className="flex items-center gap-0.5 self-start rounded-md border border-border/60 bg-background p-0.5" data-testid="library-tabs">
						{(["books", "papers", "feed"] as const).map((t) => (
							<button key={t} type="button" aria-pressed={tab === t} onClick={() => pickTab(t)} className={libraryTabClass(tab === t)}>
								{t}
							</button>
						))}
					</div>

					{tab === "papers" && <PapersTab />}
					{tab === "feed" && <FeedTab />}
					{tab === "books" && (
					<>

					<div className="space-y-2 rounded-xl border border-border p-3" data-testid="library-add">
						<div className="flex items-center gap-2">
							<input
								ref={fileRef}
								type="file"
								accept="application/pdf,.pdf"
								className="hidden"
								onChange={(e) => {
									const file = e.target.files?.[0];
									e.target.value = "";
									if (!file) return;
									const form = new FormData();
									form.append("file", file);
									void add({ body: form });
								}}
							/>
							<button
								type="button"
								disabled={busy}
								onClick={() => fileRef.current?.click()}
								className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
							>
								<UploadIcon className="size-3.5" /> Add a PDF…
							</button>
							<span className="text-xs text-muted-foreground/60">or</span>
							<form
								className="flex min-w-0 flex-1 items-center gap-1.5"
								onSubmit={(e) => {
									e.preventDefault();
									if (url.trim()) void add({ headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: url.trim() }) });
								}}
							>
								<input
									value={url}
									onChange={(e) => setUrl(e.target.value)}
									placeholder="Paste a PDF link…"
									aria-label="PDF link"
									className="lh-input h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-xs outline-none placeholder:text-muted-foreground/60 focus:border-muted-foreground/50"
								/>
								<button
									type="submit"
									disabled={busy || !url.trim()}
									aria-label="Add from link"
									className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
								>
									<LinkIcon className="size-3.5" />
								</button>
							</form>
						</div>
						{busy && (
							<div className="flex items-center gap-2 text-xs text-muted-foreground">
								<BrailleSpinner /> Adding the book…
							</div>
						)}
						{error && (
							<p role="alert" className="text-xs text-red-400">
								{error}
							</p>
						)}
					</div>

					{books.length === 0 ? (
						<p className="py-6 text-center text-sm text-muted-foreground">No books yet.</p>
					) : (
						<div className="space-y-2" data-testid="library-books">
							{books.map((b) => (
								<Link
									key={b.id}
									href={`/library/${b.id}`}
									className="flex items-center gap-3 rounded-lg border border-border/70 px-3 py-2.5 transition-colors hover:bg-accent"
								>
									<BookOpenIcon className="size-4 shrink-0 text-muted-foreground" />
									<span className="min-w-0 flex-1">
										<span className="block truncate font-prose text-sm">{b.title}</span>
										<span className="block truncate text-xs text-muted-foreground">
											{b.pageCount} pages · {coverageLine(b)}
											{b.pinnedGoals.length > 0 ? ` · pinned to ${b.pinnedGoals.map((g) => g.title).join(", ")}` : ""}
										</span>
									</span>
									{b.working && <BrailleSpinner />}
								</Link>
							))}
						</div>
					)}
					</>
					)}
				</div>
			</div>
		</div>
	);
}
