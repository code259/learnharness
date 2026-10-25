"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ExternalLinkIcon, Trash2Icon } from "lucide-react";
import type { PaperView, PredictionOutcome } from "@/src/core";
import { TopBar } from "@/components/top-bar";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { DepthPicker } from "@/components/papers-feed";
import { useServerEvent, useServerResync } from "@/components/server-events";
import { timeAgo } from "@/components/sidebar";

/**
 * A PAPER PAGE (fork #8 — docs/papers-feed.md): the abstract, Read it at a
 * depth (Skim / Standard / Deep → a normal paper-shaped session), the
 * predictions committed in its sessions, those sessions, and Delete.
 */

const OUTCOME: Record<PredictionOutcome, string> = { held: "held", partly: "partly held", missed: "missed" };

export function PaperPage({ initialView }: { initialView: PaperView }) {
	const router = useRouter();
	const [view, setView] = useState(initialView);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [confirmDelete, setConfirmDelete] = useState(false);
	const id = initialView.id;
	const refresh = useCallback(async () => {
		try {
			const res = await fetch(`/api/papers/${id}`, { cache: "no-store" });
			if (res.status === 404) router.push("/library?tab=papers");
			else if (res.ok) setView((await res.json()) as PaperView);
		} catch {
			// keep the last view
		}
	}, [id, router]);
	useServerEvent("papers-changed", () => void refresh());
	useServerEvent("chats-changed", () => void refresh());
	useServerResync(() => void refresh());
	useEffect(() => {
		void refresh();
	}, [refresh]);

	const read = async (depth: string) => {
		setBusy(true);
		setError(null);
		try {
			const res = await fetch(`/api/papers/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "read", depth }) });
			const data = (await res.json().catch(() => ({}))) as { id?: string; prompt?: string; error?: string };
			if (!res.ok || !data.id) setError(data.error ?? `Couldn't start the session (${res.status})`);
			else router.push(`/chat/${data.id}?prompt=${encodeURIComponent(data.prompt ?? "")}`);
		} finally {
			setBusy(false);
		}
	};

	const link = view.arxivId ? `https://arxiv.org/abs/${view.arxivId}` : view.source.kind === "url" ? view.source.name : null;
	return (
		<div className="flex h-dvh flex-col">
			<TopBar>
				<h1 className="min-w-0 flex-1 truncate font-title text-3xl tracking-tight">{view.title}</h1>
				<button type="button" aria-label="Delete paper" onClick={() => setConfirmDelete(true)} className="flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
					<Trash2Icon className="size-4" />
				</button>
			</TopBar>
			<div className="min-h-0 flex-1 overflow-y-auto">
				<div className="mx-auto w-full max-w-[46rem] space-y-5 px-4 py-5">
					<div className="space-y-1 text-xs text-muted-foreground">
						{view.authors.length > 0 && <p>{view.authors.join(", ")}</p>}
						<p>
							{view.format === "pdf" ? `${view.pageCount} pages` : "Web article"}
							{link && (
								<>
									{" · "}
									<a href={link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-foreground">
										{view.arxivId ? `arXiv ${view.arxivId}` : "source"} <ExternalLinkIcon className="size-3" />
									</a>
								</>
							)}
						</p>
					</div>
					{view.abstract && <p className="font-prose text-sm leading-relaxed text-foreground/90">{view.abstract}</p>}
					<div className="space-y-1">
						<DepthPicker busy={busy} onPick={(d) => void read(d)} />
						<p className="text-[11px] text-muted-foreground/70">
							Skim: the claim and the key result. Standard: predict → fill gaps → derive → results → critique. Deep: plus the derivation in full, ablations, what you'd test next.
						</p>
					</div>
					{error && (
						<p role="alert" className="text-xs text-red-400">
							{error}
						</p>
					)}

					{view.predictionList.length > 0 && (
						<section className="space-y-1.5" data-testid="paper-predictions">
							<h2 className="text-xs uppercase tracking-widest text-muted-foreground/70">Your predictions</h2>
							{view.predictionList.map((p) => (
								<div key={p.id} className="flex gap-3 rounded-lg border border-border/60 px-3 py-2 text-xs">
									<span className="shrink-0 tabular-nums text-muted-foreground">{p.confidence}%</span>
									<span className="min-w-0 flex-1 text-foreground/90">{p.statement}</span>
									<span className="shrink-0 text-muted-foreground">{p.outcome ? OUTCOME[p.outcome] : "not resolved"}</span>
								</div>
							))}
						</section>
					)}

					{view.sessionList.length > 0 && (
						<section className="space-y-1">
							<h2 className="text-xs uppercase tracking-widest text-muted-foreground/70">Sessions</h2>
							{view.sessionList.map((s) => (
								<Link key={s.id} href={`/chat/${s.id}`} className="flex items-center gap-2 rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-accent hover:text-foreground">
									<span className="min-w-0 flex-1 truncate">{s.title}</span>
									<span className="shrink-0 text-xs">{timeAgo(s.updatedAt)}</span>
								</Link>
							))}
						</section>
					)}
				</div>
			</div>
			<ConfirmDialog
				open={confirmDelete}
				title="Delete paper?"
				subject={view.title}
				body="This removes the paper, its copy, and its prediction record from your library. Sessions that read it and your knowledge graph are not affected."
				testid="paper-delete-dialog"
				onConfirm={async () => {
					const res = await fetch(`/api/papers/${id}`, { method: "DELETE" }).catch(() => null);
					if (res?.ok) router.push("/library?tab=papers");
					return res?.ok ?? false;
				}}
				onClose={() => setConfirmDelete(false)}
			/>
		</div>
	);
}
