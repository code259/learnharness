"use client";

import { useEffect, useRef, useState } from "react";
import { InboxIcon } from "lucide-react";

/**
 * THE QUICK-CAPTURE BOX (fork #6, docs/today-inbox.md): the whole page of
 * the small always-on-top window ⌥⌘L opens (electron/main.cjs). A full-bleed
 * layer over the app shell (the window is narrower than the sidebar's
 * auto-close width, so only this shows): type, Enter saves to the inbox and
 * the window closes; Esc closes without saving. The whole box is a window
 * drag surface except the field itself (native inputs carve out).
 */
export function CaptureBox() {
	const [text, setText] = useState("");
	const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
	const inputRef = useRef<HTMLTextAreaElement>(null);

	useEffect(() => {
		inputRef.current?.focus();
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.preventDefault();
				e.stopPropagation();
				window.close();
			}
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, []);

	const save = async () => {
		const t = text.trim();
		if (!t || state === "saving") return;
		setState("saving");
		try {
			const res = await fetch("/api/inbox", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ text: t }),
			});
			if (!res.ok) throw new Error(String(res.status));
			setState("saved");
			setTimeout(() => window.close(), 350);
		} catch {
			setState("error");
		}
	};

	return (
		<div className="lh-drag fixed inset-0 z-[100] flex flex-col justify-center gap-1.5 bg-card px-4" data-testid="capture-box">
			<div className="flex items-center gap-1.5 text-[11px] uppercase tracking-widest text-muted-foreground">
				<InboxIcon className="size-3.5" /> Capture to inbox
				<span className="ml-auto normal-case tracking-normal text-muted-foreground/60">
					{state === "saved" ? "Saved" : state === "error" ? "Couldn't save — is LearnHarness running?" : "Enter to save · Esc to close"}
				</span>
			</div>
			<textarea
				ref={inputRef}
				value={text}
				onChange={(e) => {
					setText(e.target.value);
					if (state === "error") setState("idle");
				}}
				onKeyDown={(e) => {
					if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
						e.preventDefault();
						void save();
					}
				}}
				rows={2}
				placeholder="A question, a paper link, something to learn…"
				aria-label="Capture to inbox"
				className="lh-input w-full resize-none rounded-lg border border-border bg-background px-3 py-2 font-prose text-sm outline-none placeholder:text-muted-foreground/60 focus:border-muted-foreground/50"
			/>
		</div>
	);
}
