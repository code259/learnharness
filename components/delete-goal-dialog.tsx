"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useBackdropDismiss } from "@/components/backdrop-dismiss";

/**
 * Roadmap deletion (goals, fork #4) — the session dialog's exact shape
 * (delete-session-dialog.tsx): red title, the goal's name, what happens,
 * ONE unchecked-by-default checkbox, Cancel + destructive Delete. Esc and
 * the backdrop cancel; failures (a session mid-turn) render with Try again.
 *
 *   unchecked — the roadmap and its conversation go; its sessions stay,
 *               moving back to the ungrouped list
 *   checked   — its sessions are deleted too (the knowledge graph keeps
 *               what they taught — the sessions' preserve-graph delete)
 */
export function DeleteGoalDialog({
	goal,
	onClose,
	onDeleted,
}: {
	/** The goal up for deletion; null = closed. */
	goal: { id: string; title: string; sessionCount: number } | null;
	onClose: () => void;
	onDeleted: (id: string) => void;
}) {
	const [withSessions, setWithSessions] = useState(false);
	const [busy, setBusy] = useState(false);
	const [failure, setFailure] = useState<string | null>(null);
	const backdropDismiss = useBackdropDismiss(() => {
		if (!busy) onClose();
	});

	useEffect(() => {
		if (!goal) {
			setWithSessions(false);
			setBusy(false);
			setFailure(null);
		}
	}, [goal]);

	useEffect(() => {
		if (!goal) return;
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.preventDefault();
				e.stopPropagation();
				if (!busy) onClose();
			}
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [goal, busy, onClose]);

	const run = async () => {
		if (!goal || busy) return;
		setBusy(true);
		setFailure(null);
		try {
			const res = await fetch(`/api/goals/${goal.id}${withSessions ? "?sessions=1" : ""}`, { method: "DELETE" });
			const body = (await res.json().catch(() => ({}))) as { error?: string };
			if (!res.ok) {
				setFailure(body.error ?? `Delete failed (${res.status})`);
				setBusy(false);
				return;
			}
			onDeleted(goal.id);
		} catch {
			setFailure("Delete failed — network error. Try again.");
			setBusy(false);
		}
	};

	if (!goal) return null;
	const n = goal.sessionCount;

	return createPortal(
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80" {...backdropDismiss}>
			<div
				role="dialog"
				aria-modal="true"
				aria-label="Delete roadmap"
				data-testid="delete-goal-dialog"
				onClick={(e) => e.stopPropagation()}
				className="w-[32rem] max-w-[calc(100vw-2rem)] rounded-xl border bg-card p-5 shadow-xl"
			>
				<h2 className="text-sm font-semibold text-destructive">Delete roadmap?</h2>
				<div className="mt-1.5">
					<code className="font-mono text-sm text-foreground">{goal.title}</code>
				</div>
				<p className="mt-2 text-sm text-muted-foreground">
					This permanently removes the goal, its roadmap, its conversation, and its suggestions.
					{n > 0 ? " Its sessions stay and move to Other sessions unless you check below." : ""} Your knowledge graph is not
					affected. This cannot be undone.
				</p>
				{n > 0 && (
					<label className="mt-4 flex cursor-pointer items-start gap-2.5 rounded-lg border border-border/60 px-4 py-3">
						<input
							type="checkbox"
							data-testid="delete-goal-sessions"
							checked={withSessions}
							onChange={(e) => setWithSessions(e.target.checked)}
							disabled={busy}
							className="mt-0.5 size-4 shrink-0 accent-primary"
						/>
						<span className="min-w-0">
							<span className="block text-sm text-foreground">
								Also delete its {n} session{n === 1 ? "" : "s"}
							</span>
							<span className="mt-1 block text-xs text-muted-foreground">
								Their messages are removed for good. What they added to your knowledge graph stays.
							</span>
						</span>
					</label>
				)}
				{failure && (
					<div role="alert" className="mt-3 rounded-sm border border-border/60 px-3 py-2 text-xs">
						<span className="text-foreground">{failure}</span>
						<button
							type="button"
							onClick={() => void run()}
							disabled={busy}
							className="ml-3 text-xs text-foreground underline-offset-2 hover:underline disabled:opacity-40"
						>
							Try again
						</button>
					</div>
				)}
				<div className="mt-4 flex justify-end gap-2">
					<button
						type="button"
						onClick={onClose}
						disabled={busy}
						className="rounded-sm px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
					>
						Cancel
					</button>
					<button
						type="button"
						data-testid="delete-goal-confirm"
						onClick={() => void run()}
						disabled={busy}
						className="rounded-sm border border-destructive/50 bg-destructive/10 px-3 py-1.5 text-xs text-destructive transition-colors hover:bg-destructive/20 disabled:opacity-40"
					>
						{busy ? "Deleting…" : "Delete"}
					</button>
				</div>
			</div>
		</div>,
		document.body,
	);
}
