"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronDownIcon, DumbbellIcon, InboxIcon, MapIcon, PlayIcon, SunIcon } from "lucide-react";
import { CaptureField } from "@/components/inbox-page";
import { TODAY_BUDGETS, type TodayBudget, type TodayItem, type TodayPlan } from "@/src/core";
import { useServerEvent, useServerResync } from "@/components/server-events";
import { BrailleSpinner } from "@/components/braille-spinner";
import { cn } from "@/lib/utils";

/**
 * THE TODAY PANEL (fork #2/#5/#6 — docs/today-inbox.md): the graph home's
 * right-hand column. A time budget (15/30/60/120 min), the plan that fits
 * it (continue → next roadmap topic → practice → inbox, fixed estimates),
 * and the inbox's capture field (the list itself is the /inbox page).
 *
 * Forgiving by construction (docs/forgiving-schedule.md): the plan is
 * fetched fresh — nothing carries over, nothing is overdue, no counts of
 * what's waiting. After a 3+ day gap the budget starts at 15 minutes.
 * Collapses to a slim pill; open/closed and the budget are remembered.
 */

const OPEN_KEY = "lh:today-open";
const BUDGET_KEY = "lh:today-budget";
const PRACTICE_TITLE = "Practice what I learned recently";

function readBudget(): TodayBudget {
	try {
		const n = Number(window.localStorage.getItem(BUDGET_KEY));
		return (TODAY_BUDGETS as readonly number[]).includes(n) ? (n as TodayBudget) : 30;
	} catch {
		return 30;
	}
}

/** "~40 min" — the plan's total, never a target to hit. */
export function totalLine(items: readonly TodayItem[]): string {
	const minutes = items.reduce((n, i) => n + i.minutes, 0);
	return minutes === 0 ? "" : `~${minutes} min`;
}

export function TodayPanel() {
	const router = useRouter();
	const [open, setOpen] = useState(true);
	const [budget, setBudget] = useState<TodayBudget>(30);
	const [plan, setPlan] = useState<TodayPlan | null>(null);
	const [busy, setBusy] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	// The gap rule applies to the FIRST plan of a visit only — a budget the
	// learner then picks is theirs.
	const gapChecked = useRef(false);
	const budgetRef = useRef(budget);
	budgetRef.current = budget;

	useEffect(() => {
		try {
			setOpen(window.localStorage.getItem(OPEN_KEY) !== "0");
		} catch {
			// default open
		}
		setBudget(readBudget());
	}, []);

	const refresh = useCallback(async () => {
		try {
			const planRes = await fetch(`/api/today?budget=${budgetRef.current}`, { cache: "no-store" });
			if (planRes.ok) {
				const next = (await planRes.json()) as TodayPlan;
				if (!gapChecked.current) {
					gapChecked.current = true;
					if (next.gap && next.budget !== 15) {
						setBudget(15); // the refetch effect below lands the 15-minute plan
						return;
					}
				}
				setPlan(next);
			}
		} catch {
			// a transient failure keeps the last view
		}
	}, []);

	useEffect(() => {
		void refresh();
	}, [budget, refresh]);

	const debounce = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const schedule = useCallback(() => {
		clearTimeout(debounce.current);
		debounce.current = setTimeout(() => void refresh(), 250);
	}, [refresh]);
	useServerEvent("inbox-changed", schedule);
	useServerEvent("goals-changed", schedule);
	useServerEvent("chats-changed", schedule);
	useServerEvent("turn-settled", schedule);
	useServerResync(() => void refresh());
	useEffect(() => () => clearTimeout(debounce.current), []);

	const toggle = (next: boolean) => {
		setOpen(next);
		try {
			window.localStorage.setItem(OPEN_KEY, next ? "1" : "0");
		} catch {
			// per-viewer convenience only
		}
	};
	const pickBudget = (b: TodayBudget) => {
		setBudget(b);
		try {
			window.localStorage.setItem(BUDGET_KEY, String(b));
		} catch {
			// per-viewer convenience only
		}
	};

	/** POST and return the JSON body, or null with the error shown. */
	const post = async (url: string, body: unknown): Promise<Record<string, unknown> | null> => {
		setError(null);
		try {
			const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
			const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
			if (!res.ok) {
				setError(typeof data.error === "string" ? data.error : `Request failed (${res.status})`);
				return null;
			}
			return data;
		} catch {
			setError("Couldn't reach the app server.");
			return null;
		}
	};

	/** Open a freshly created session with its first message. */
	const go = (data: Record<string, unknown> | null, prompt: string) => {
		if (data && typeof data.id === "string") router.push(`/chat/${data.id}?prompt=${encodeURIComponent(prompt)}`);
	};

	const runItem = async (item: TodayItem, key: string) => {
		setBusy(key);
		try {
			if (item.kind === "continue") {
				router.push(`/chat/${item.chatId}`);
			} else if (item.kind === "topic") {
				const data = await post(`/api/goals/${item.goalId}/topics/${item.topicId}/start`, {});
				go(data, typeof data?.prompt === "string" ? data.prompt : item.topicTitle);
			} else if (item.kind === "practice") {
				const data = await post("/api/chats", { title: PRACTICE_TITLE, kind: "practice", graphContext: { propositions: item.picks } });
				go(data, PRACTICE_TITLE);
			} else {
				const data = await post(`/api/inbox/${item.itemId}`, { action: "start" });
				go(data, typeof data?.prompt === "string" ? data.prompt : item.text);
			}
		} finally {
			setBusy(null);
		}
	};

	if (!open) {
		return (
			<button
				type="button"
				onClick={() => toggle(true)}
				data-testid="today-open"
				className="flex h-9 items-center gap-1.5 rounded-xl border bg-card/85 px-3 text-xs text-muted-foreground shadow-lg backdrop-blur transition-colors hover:text-foreground"
			>
				<SunIcon className="size-3.5" /> Today
			</button>
		);
	}

	return (
		<section
			data-testid="today-panel"
			className="flex max-h-[calc(100dvh-14rem)] w-80 max-w-full flex-col overflow-hidden rounded-xl border bg-card/90 shadow-lg backdrop-blur"
		>
			<div className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
				<SunIcon className="size-3.5 text-muted-foreground" />
				<span className="text-xs uppercase tracking-widest text-muted-foreground">Today</span>
				<span className="ml-auto text-[11px] text-muted-foreground/70">{plan ? totalLine(plan.items) : ""}</span>
				<button
					type="button"
					aria-label="Collapse Today"
					onClick={() => toggle(false)}
					className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
				>
					<ChevronDownIcon className="size-3.5" />
				</button>
			</div>

			<div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
				{/* the time budget */}
				<div className="flex items-center gap-0.5 rounded-md border border-border/60 bg-background p-0.5" data-testid="today-budget">
					{TODAY_BUDGETS.map((b) => (
						<button
							key={b}
							type="button"
							onClick={() => pickBudget(b)}
							aria-pressed={budget === b}
							className={cn(
								"flex-1 rounded-sm px-1.5 py-1 text-[11px] tabular-nums transition-colors",
								budget === b ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground",
							)}
						>
							{b < 60 ? `${b}m` : `${b / 60}h`}
						</button>
					))}
				</div>

				{error && (
					<p role="alert" className="text-xs text-red-400">
						{error}
					</p>
				)}

				{/* the plan */}
				{plan === null ? (
					<div className="flex items-center gap-2 text-xs text-muted-foreground">
						<BrailleSpinner /> Loading…
					</div>
				) : plan.items.length === 0 ? (
					<p className="text-xs leading-relaxed text-muted-foreground">
						Nothing queued yet. Start anything from the composer below, or capture an idea for later.
					</p>
				) : (
					<ol className="space-y-1.5" data-testid="today-items">
						{plan.items.map((item, i) => {
							const key = `${item.kind}-${i}`;
							return <TodayRow key={key} item={item} busy={busy === key} onRun={() => void runItem(item, key)} />;
						})}
					</ol>
				)}

				<InboxSection post={post} />
			</div>
		</section>
	);
}

const KIND_LABEL: Record<TodayItem["kind"], string> = {
	continue: "Continue",
	topic: "Next on your roadmap",
	practice: "Practice",
	inbox: "From your inbox",
};

function itemTitle(item: TodayItem): string {
	switch (item.kind) {
		case "continue":
			return item.title;
		case "topic":
			return item.topicTitle;
		case "practice":
			return `${item.picks.length} thing${item.picks.length === 1 ? "" : "s"} you learned recently`;
		case "inbox":
			return item.text;
	}
}

function itemSub(item: TodayItem): string | null {
	if (item.kind === "topic") return item.goalTitle;
	if (item.kind === "continue") return item.goalTitle ?? null;
	return null;
}

export function TodayRow({ item, busy, onRun }: { item: TodayItem; busy: boolean; onRun: () => void }) {
	const Icon = item.kind === "topic" ? MapIcon : item.kind === "practice" ? DumbbellIcon : item.kind === "inbox" ? InboxIcon : PlayIcon;
	const sub = itemSub(item);
	return (
		<li data-testid={`today-item-${item.kind}`}>
			<button
				type="button"
				onClick={onRun}
				disabled={busy}
				className="flex w-full items-start gap-2.5 rounded-lg border border-border/70 px-2.5 py-2 text-left transition-colors hover:bg-accent disabled:opacity-60"
			>
				<span className="mt-0.5 shrink-0 text-muted-foreground">{busy ? <BrailleSpinner /> : <Icon className="size-3.5" />}</span>
				<span className="min-w-0 flex-1">
					<span className="block text-[11px] uppercase tracking-wider text-muted-foreground/80">
						{KIND_LABEL[item.kind]} · ~{item.minutes}m
					</span>
					<span className="line-clamp-2 font-prose text-sm text-foreground">{itemTitle(item)}</span>
					{sub && <span className="block truncate text-[11px] text-muted-foreground">{sub}</span>}
				</span>
			</button>
		</li>
	);
}

/** The panel's inbox corner: capture + a door to the inbox page. The list
 *  itself lives on /inbox so the panel never grows with the inbox. */
function InboxSection({ post }: { post: (url: string, body: unknown) => Promise<Record<string, unknown> | null> }) {
	return (
		<div className="space-y-2 border-t border-border/60 pt-3" data-testid="today-inbox">
			<div className="flex items-center gap-1.5 text-xs uppercase tracking-widest text-muted-foreground">
				<InboxIcon className="size-3.5" /> Inbox
				<span className="ml-auto text-[10px] normal-case tracking-normal text-muted-foreground/60">⌥⌘L anywhere</span>
			</div>
			<CaptureField post={post} compact />
			<Link href="/inbox" className="inline-block text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
				Open inbox →
			</Link>
		</div>
	);
}
