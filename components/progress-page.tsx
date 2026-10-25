"use client";

import { useCallback, useEffect, useState } from "react";
import { ExternalLinkIcon } from "lucide-react";
import { addDays, ymd, type ProgressView } from "@/src/core";
import { TopBar } from "@/components/top-bar";
import { CalibrationView } from "@/components/papers-feed";
import { totalsLine } from "@/components/field-map";
import { timeAgo } from "@/components/sidebar";
import { useServerEvent, useServerResync } from "@/components/server-events";

/**
 * THE PROGRESS PAGE (fork #12 — docs/exercises-progress.md): a mirror, not a
 * scoreboard. Four sections — knowledge growth, goals & field, reading &
 * taste, practice & activity. Everything is derived from what the other
 * stores already hold. No streaks, no "behind", no red: a day you didn't
 * study is just a blank square (docs/forgiving-schedule.md).
 */
export function ProgressPage({ initialView }: { initialView: ProgressView }) {
	const [view, setView] = useState<ProgressView>(initialView);

	const refresh = useCallback(async () => {
		try {
			const res = await fetch("/api/progress", { cache: "no-store" });
			if (res.ok) setView((await res.json()) as ProgressView);
		} catch {
			// keep the last view
		}
	}, []);
	useEffect(() => {
		void refresh();
	}, [refresh]);
	useServerEvent("turn-settled", () => void refresh());
	useServerEvent("chats-changed", () => void refresh());
	useServerEvent("goals-changed", () => void refresh());
	useServerEvent("library-changed", () => void refresh());
	useServerEvent("fieldmap-changed", () => void refresh());
	useServerEvent("papers-changed", () => void refresh());
	useServerEvent("exercises-changed", () => void refresh());
	useServerResync(() => void refresh());

	return (
		<div className="flex h-dvh flex-col">
			<TopBar>
				<h1 className="min-w-0 flex-1 truncate font-title text-3xl tracking-tight">Progress</h1>
			</TopBar>
			<div className="min-h-0 flex-1 overflow-y-auto">
				<div className="mx-auto w-full max-w-3xl space-y-8 px-6 pt-4 pb-16">
					<Growth growth={view.growth} />
					<GoalsField goals={view.goals} field={view.field} />
					<Reading reading={view.reading} />
					<Practice practice={view.practice} activeDays={view.activeDays} calendar={view.calendar} />
				</div>
			</div>
		</div>
	);
}

function Section({ title, children, testId }: { title: string; children: React.ReactNode; testId: string }) {
	return (
		<section className="space-y-3" data-testid={testId}>
			<h2 className="text-xs uppercase tracking-widest text-muted-foreground">{title}</h2>
			{children}
		</section>
	);
}

function Empty({ children }: { children: React.ReactNode }) {
	return <p className="text-xs leading-relaxed text-muted-foreground">{children}</p>;
}

/** A labeled bar: covered of total. */
function Bar({ label, covered, total }: { label: string; covered: number; total: number }) {
	const pct = total > 0 ? Math.round((covered / total) * 100) : 0;
	return (
		<div className="grid grid-cols-[minmax(0,1fr)_10rem_5.5rem] items-center gap-3 text-xs">
			<span className="min-w-0 truncate text-foreground">{label}</span>
			<div className="h-2 overflow-hidden rounded-full border border-border/70">
				<div className="h-full bg-foreground" style={{ width: `${pct}%` }} />
			</div>
			<span className="tabular-nums text-muted-foreground">
				{covered}/{total} · {pct}%
			</span>
		</div>
	);
}

/** A small line chart (no axes — the numbers are in the text beside it). */
function Sparkline({ values, label }: { values: number[]; label: string }) {
	if (values.length < 2) return null;
	const w = 560;
	const h = 72;
	const max = Math.max(1, ...values);
	const pts = values.map((v, i) => `${((i / (values.length - 1)) * w).toFixed(1)},${(h - 4 - (v / max) * (h - 8)).toFixed(1)}`);
	return (
		<svg viewBox={`0 0 ${w} ${h}`} className="h-[72px] w-full text-foreground" role="img" aria-label={label} preserveAspectRatio="none">
			<polyline points={pts.join(" ")} fill="none" stroke="currentColor" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
		</svg>
	);
}

function Growth({ growth }: { growth: ProgressView["growth"] }) {
	return (
		<Section title="Knowledge growth" testId="progress-growth">
			{growth.total === 0 ? (
				<Empty>As you learn in teaching sessions, the ideas you come to hold are added to your knowledge graph. Their growth over time shows here.</Empty>
			) : (
				<>
					<p className="font-prose text-sm">
						{growth.total} idea{growth.total === 1 ? "" : "s"} in your knowledge graph
						<span className="text-muted-foreground">
							{" "}
							· {growth.newThisWeek} new this week · {growth.newThisMonth} this month
						</span>
					</p>
					<Sparkline values={growth.points.map((p) => p.total)} label="Ideas in your knowledge graph, by week" />
					{growth.points.length > 1 && <p className="text-[11px] text-muted-foreground/70">Weekly, since {growth.points[0]!.week}.</p>}
				</>
			)}
		</Section>
	);
}

function GoalsField({ goals, field }: { goals: ProgressView["goals"]; field: ProgressView["field"] }) {
	return (
		<Section title="Goals & field" testId="progress-goals">
			{goals.length === 0 ? (
				<Empty>Active goals show here with how much of each roadmap you know.</Empty>
			) : (
				<div className="space-y-1.5">
					{goals.map((g) => (
						<Bar key={g.id} label={g.title} covered={g.covered} total={g.total} />
					))}
				</div>
			)}
			{field && field.total > 0 && (
				<div className="space-y-1 pt-1">
					<p className="font-prose text-sm">{totalsLine(field)} on the AI safety field map.</p>
					<Sparkline values={field.history.map((s) => s.known)} label="Field-map concepts you know, over time" />
				</div>
			)}
		</Section>
	);
}

function Reading({ reading }: { reading: ProgressView["reading"] }) {
	return (
		<Section title="Reading & taste" testId="progress-reading">
			<p className="font-prose text-sm">
				{reading.papersRead} paper{reading.papersRead === 1 ? "" : "s"} read
				<span className="text-muted-foreground">
					{" "}
					· {reading.paperSessions} session{reading.paperSessions === 1 ? "" : "s"}
				</span>
			</p>
			{reading.books.length > 0 && (
				<div className="space-y-1.5">
					{reading.books.map((b) => (
						<Bar key={b.id} label={b.title} covered={b.covered} total={b.total} />
					))}
				</div>
			)}
			<CalibrationView bands={reading.calibration.bands} open={reading.calibration.open} />
		</Section>
	);
}

function Practice({ practice, activeDays, calendar }: { practice: ProgressView["practice"]; activeDays: string[]; calendar: ProgressView["calendar"] }) {
	return (
		<Section title="Practice & activity" testId="progress-practice">
			{practice.done + practice.struggled === 0 ? (
				<Empty>The teacher suggests exercises in teaching sessions; mark them Done or Struggled on their cards and they count here.</Empty>
			) : (
				<>
					<p className="font-prose text-sm">
						{practice.done} exercise{practice.done === 1 ? "" : "s"} done
						{practice.struggled > 0 && <span className="text-muted-foreground"> · {practice.struggled} struggled with</span>}
					</p>
					<ul className="space-y-1">
						{practice.recent.map((m) => (
							<li key={m.callId} className="flex min-w-0 items-center gap-2 text-xs">
								<span className="w-16 shrink-0 text-muted-foreground">{m.status === "done" ? "Done" : "Struggled"}</span>
								<a href={m.url} target="_blank" rel="noreferrer" className="inline-flex min-w-0 items-center gap-1 truncate text-foreground hover:underline">
									<span className="truncate">{m.title}</span> <ExternalLinkIcon className="size-3 shrink-0 text-muted-foreground" />
								</a>
								<span className="shrink-0 text-muted-foreground/70">
									{m.source} · {timeAgo(m.markedAt)}
								</span>
							</li>
						))}
					</ul>
				</>
			)}
			<ActivityCalendar activeDays={activeDays} calendar={calendar} />
		</Section>
	);
}

/** The last N weeks as columns of 7 days. Active days are filled; others
 *  are blank outlines. Nothing counts a run or marks a gap. */
export function ActivityCalendar({ activeDays, calendar, now = new Date() }: { activeDays: string[]; calendar: ProgressView["calendar"]; now?: Date }) {
	const active = new Set(activeDays);
	const today = ymd(now);
	const [y, m, d] = calendar.start.split("-").map(Number);
	const start = new Date(y!, m! - 1, d!);
	const weeks = Array.from({ length: calendar.weeks }, (_, w) => Array.from({ length: 7 }, (_, i) => ymd(addDays(start, w * 7 + i))));
	return (
		<div className="space-y-1.5 pt-1" data-testid="activity-calendar">
			<div className="flex gap-[3px]" role="img" aria-label={`Days with study activity in the last ${calendar.weeks} weeks: ${active.size}`}>
				{weeks.map((days, w) => (
					<div key={w} className="flex flex-col gap-[3px]">
						{days.map((day) =>
							day > today ? (
								<span key={day} className="size-2.5" />
							) : (
								<span
									key={day}
									title={day}
									data-active={active.has(day) || undefined}
									className={active.has(day) ? "size-2.5 rounded-[2px] bg-foreground/80" : "size-2.5 rounded-[2px] border border-border/70"}
								/>
							),
						)}
					</div>
				))}
			</div>
			<p className="text-[11px] text-muted-foreground/70">
				{active.size} day{active.size === 1 ? "" : "s"} with study in the last {calendar.weeks} weeks.
			</p>
		</div>
	);
}
