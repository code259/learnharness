"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useBackdropDismiss } from "@/components/backdrop-dismiss";

/**
 * The destructive-confirmation dialog — the session/roadmap delete dialogs'
 * shape for simple cases (an inbox item, a book): red title, a subject line,
 * the consequence, Cancel + destructive confirm. Esc and the backdrop
 * cancel; while the action runs nothing can dismiss it; a failure keeps the
 * dialog open (the caller shows its error).
 */
export function ConfirmDialog({
	open,
	title,
	subject,
	body,
	confirmLabel = "Delete",
	onConfirm,
	onClose,
	testid,
}: {
	open: boolean;
	title: string;
	subject?: ReactNode;
	body: ReactNode;
	confirmLabel?: string;
	/** Resolves true when done (the dialog closes), false to stay open. */
	onConfirm: () => Promise<boolean>;
	onClose: () => void;
	testid?: string;
}) {
	const [busy, setBusy] = useState(false);
	const busyRef = useRef(busy);
	busyRef.current = busy;
	const backdrop = useBackdropDismiss(() => {
		if (!busyRef.current) onClose();
	});
	useEffect(() => {
		if (!open) {
			setBusy(false);
			return;
		}
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.preventDefault();
				e.stopPropagation();
				if (!busyRef.current) onClose();
			}
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [open, onClose]);
	if (!open) return null;
	return createPortal(
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80" {...backdrop}>
			<div
				role="dialog"
				aria-modal="true"
				aria-label={title}
				data-testid={testid}
				onClick={(e) => e.stopPropagation()}
				className="w-[28rem] max-w-[calc(100vw-2rem)] rounded-xl border bg-card p-5 shadow-xl"
			>
				<h2 className="text-sm font-semibold text-destructive">{title}</h2>
				{subject && <div className="mt-2 line-clamp-4 whitespace-pre-wrap font-mono text-sm text-foreground">{subject}</div>}
				<div className="mt-2 text-sm text-muted-foreground">{body}</div>
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
						data-testid={testid ? `${testid}-confirm` : undefined}
						disabled={busy}
						onClick={async () => {
							setBusy(true);
							const done = await onConfirm();
							setBusy(false);
							if (done) onClose();
						}}
						className="rounded-sm border border-destructive/50 bg-destructive/10 px-3 py-1.5 text-xs text-destructive transition-colors hover:bg-destructive/20 disabled:opacity-40"
					>
						{busy ? "Working…" : confirmLabel}
					</button>
				</div>
			</div>
		</div>,
		document.body,
	);
}
