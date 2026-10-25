"use client";

import { useCallback, useContext, useEffect, useState } from "react";
import { CheckIcon, DumbbellIcon, ExternalLinkIcon, MessageSquareIcon } from "lucide-react";
import type { ArtifactPartProps, ExerciseMark, ExerciseStatus, ExerciseSuggestion } from "@/src/core";
import { ChatActionsContext } from "@/components/chat";
import { useServerEvent } from "@/components/server-events";
import { cn } from "@/lib/utils";

/**
 * The exercise card (fork #11 — docs/exercises-progress.md): what the
 * teacher's suggest_exercise shows in the chat — title, source, link, why.
 * Mark it Done or Struggled (with an optional note); a struggled mark can
 * be talked through with the teacher in one click (a normal message).
 * Marks are saved server-side and counted on the Progress page.
 */
export function ExerciseCard({ part }: ArtifactPartProps) {
	const actions = useContext(ChatActionsContext);
	const ex = part.input as Partial<ExerciseSuggestion> | undefined;
	const [mark, setMark] = useState<ExerciseMark | null>(null);
	const [noting, setNoting] = useState<ExerciseStatus | null>(null);
	const [note, setNote] = useState("");
	const [error, setError] = useState<string | null>(null);
	const callId = part.toolCallId;

	const load = useCallback(async () => {
		try {
			const res = await fetch(`/api/exercises/${callId}`, { cache: "no-store" });
			if (res.ok) setMark(((await res.json()) as { mark: ExerciseMark | null }).mark);
		} catch {
			// keep the last state
		}
	}, [callId]);
	useEffect(() => {
		void load();
	}, [load]);
	useServerEvent("exercises-changed", () => void load());

	if (part.state !== "output-available" || !ex?.title || !ex.url) return null;

	const save = async (status: ExerciseStatus, text?: string) => {
		if (!actions) return;
		setError(null);
		const res = await fetch(`/api/exercises/${callId}`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ chatId: actions.chatId, status, note: text }),
		}).catch(() => null);
		if (!res?.ok) {
			setError("Couldn't save the mark.");
			return;
		}
		setMark(((await res.json()) as { mark: ExerciseMark }).mark);
		setNoting(null);
	};

	return (
		<div className="my-2 w-full max-w-2xl rounded-xl border border-border/80 px-3 py-2.5" data-testid="exercise-card">
			<div className="flex items-start gap-2">
				<DumbbellIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
				<div className="min-w-0 flex-1">
					<a href={ex.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-prose text-sm text-foreground hover:underline">
						{ex.title} <ExternalLinkIcon className="size-3 text-muted-foreground" />
					</a>
					<div className="text-[11px] text-muted-foreground">{ex.source}</div>
					{ex.why && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{ex.why}</p>}
				</div>
			</div>
			<div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
				{(["done", "struggled"] as const).map((s) => (
					<button
						key={s}
						type="button"
						onClick={() => setNoting(s)}
						aria-pressed={mark?.status === s}
						className={cn(
							"flex items-center gap-1 rounded-md border px-2 py-0.5 transition-colors",
							mark?.status === s ? "border-foreground/60 text-foreground" : "border-border text-muted-foreground hover:bg-accent hover:text-foreground",
						)}
					>
						{mark?.status === s && <CheckIcon className="size-3" />}
						{s === "done" ? "Done" : "Struggled"}
					</button>
				))}
				{mark?.status === "struggled" && actions && (
					<button
						type="button"
						onClick={() => actions.sendText(`I struggled with the exercise “${mark.title}”${mark.note ? `: ${mark.note}` : "."} Can we work through what was hard?`)}
						className="flex items-center gap-1 rounded-md px-2 py-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
					>
						<MessageSquareIcon className="size-3" /> Talk it through
					</button>
				)}
				{mark?.note && <span className="min-w-0 truncate text-muted-foreground/70">“{mark.note}”</span>}
			</div>
			{noting && (
				<form
					className="mt-2 flex items-center gap-1.5"
					onSubmit={(e) => {
						e.preventDefault();
						void save(noting, note);
					}}
				>
					<input
						autoFocus
						value={note}
						onChange={(e) => setNote(e.target.value)}
						placeholder={noting === "struggled" ? "What was hard? (optional)" : "Any note? (optional)"}
						aria-label="Exercise note"
						className="lh-input h-7 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-xs outline-none placeholder:text-muted-foreground/60 focus:border-muted-foreground/50"
					/>
					<button type="submit" className="rounded-md border border-border px-2 py-0.5 text-xs text-foreground transition-colors hover:bg-accent">
						Save
					</button>
				</form>
			)}
			{error && <p className="mt-1 text-xs text-red-400">{error}</p>}
		</div>
	);
}
