"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeftIcon, CheckIcon, GraduationCapIcon, MapIcon, PlayIcon, RefreshCwIcon, SparklesIcon, XIcon } from "lucide-react";
import { fieldTotals, standing, type AgendaView, type FieldMapView, type GoalSummary, type IdeaStatus, type StandingRow } from "@/src/core";
import { TopBar } from "@/components/top-bar";
import { BrailleSpinner } from "@/components/braille-spinner";
import { useServerEvent, useServerResync } from "@/components/server-events";
import { timeAgo } from "@/components/sidebar";
import { cn } from "@/lib/utils";

/**
 * THE AI SAFETY FIELD MAP (fork #10 — docs/field-map.md).
 *
 *   Where you stand — the headline: per area (or per agenda, drilled into an
 *                     area or a ticked selection), how much of the key
 *                     concepts you know, as sorted bars. A mirror that
 *                     informs what to look at next; nothing acts on it.
 *   Territory grid  — area blocks with agenda tiles shaded by what you know;
 *                     tick tiles to compare a selection; click for details.
 *   Agenda panel    — summary, theory of change, concepts with known/partly/
 *                     not-yet marks; Learn this agenda / Add to a roadmap /
 *                     Make it a goal.
 *   Updates         — "Update the map" researches changes since the last
 *                     update and proposes them; you accept or reject.
 */

type Post = (body: unknown, url?: string) => Promise<Record<string, unknown> | null>;

const MARK: Record<IdeaStatus, string> = { held: "✓", partly: "◐", "not-yet": "·" };

/** "You know 34 of 412 key concepts (21 partly)". */
export function totalsLine(t: { known: number; partly: number; total: number }): string {
	return `You know ${t.known} of ${t.total} key concepts${t.partly > 0 ? ` (${t.partly} more partly)` : ""}`;
}

export function FieldMapPage({ initialView, initialAgendaId }: { initialView: FieldMapView; initialAgendaId?: string }) {
	const router = useRouter();
	const [view, setView] = useState<FieldMapView>(initialView);
	const [goals, setGoals] = useState<GoalSummary[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [selectedId, setSelectedId] = useState<string | null>(initialAgendaId ?? null);
	const [picked, setPicked] = useState<Set<string>>(new Set());
	const [drillArea, setDrillArea] = useState<string | null>(null);

	const refresh = useCallback(async () => {
		try {
			const [res, goalsRes] = await Promise.all([fetch("/api/field-map", { cache: "no-store" }), fetch("/api/goals", { cache: "no-store" })]);
			if (res.ok) setView((await res.json()) as FieldMapView);
			if (goalsRes.ok) setGoals(((await goalsRes.json()) as { goals: GoalSummary[] }).goals.filter((g) => g.status === "active"));
		} catch {
			// keep the last view
		}
	}, []);
	useEffect(() => {
		void refresh();
	}, [refresh]);
	useServerEvent("fieldmap-changed", () => void refresh());
	useServerEvent("goals-changed", () => void refresh());
	useServerResync(() => void refresh());

	const post: Post = useCallback(
		async (body, url = "/api/field-map") => {
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
			} finally {
				void refresh();
			}
		},
		[refresh],
	);

	const agendas = useMemo(() => view.areas.flatMap((a) => a.agendas.map((g) => ({ ...g, areaTitle: a.title }))), [view.areas]);
	const selected = agendas.find((g) => g.id === selectedId) ?? null;
	const ready = view.areas.length > 0;

	return (
		<div className="flex h-dvh flex-col">
			<TopBar>
				<h1 className="min-w-0 flex-1 truncate font-title text-3xl tracking-tight">AI safety field map</h1>
				{ready && (
					<>
						<span className="hidden shrink-0 text-xs text-muted-foreground md:inline">
							{view.updatedAt ? `updated ${timeAgo(view.updatedAt)}` : ""}
						</span>
						<HeaderButton disabled={view.working} onClick={() => void post({ action: "recheck" })} icon={<RefreshCwIcon className="size-3" />}>
							Recheck
						</HeaderButton>
						<HeaderButton disabled={view.working} onClick={() => void post({ action: "update" })} icon={<SparklesIcon className="size-3" />}>
							Update the map
						</HeaderButton>
					</>
				)}
			</TopBar>

			<div className="flex min-h-0 flex-1">
				<div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
					<div className="mx-auto w-full max-w-[64rem] space-y-6 px-5 py-5">
						{error && (
							<p role="alert" className="text-xs text-red-400">
								{error}
							</p>
						)}
						{view.working && view.progress && (
							<div className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="fieldmap-progress">
								<BrailleSpinner /> {view.progress}
							</div>
						)}
						{view.error && !view.working && <p className="text-xs text-muted-foreground">{view.error}</p>}

						{!ready && !view.working && <EmptyState onBuild={() => void post({ action: "build" })} failed={view.status === "error"} />}

						{ready && (
							<>
								<StandingPanel
									view={view}
									picked={picked}
									drillArea={drillArea}
									onDrill={setDrillArea}
									onClearPicked={() => setPicked(new Set())}
									onOpenAgenda={setSelectedId}
								/>
								{view.proposals.length > 0 && <Proposals view={view} post={post} />}
								<div className="space-y-5" data-testid="fieldmap-grid">
									{view.areas.map((area) => (
										<section key={area.id} className="space-y-2">
											<div className="flex items-baseline gap-2">
												<h2 className="font-prose text-base text-foreground">{area.title}</h2>
												<span className="text-xs tabular-nums text-muted-foreground">
													{area.known}/{area.total}
												</span>
											</div>
											{area.summary && <p className="text-xs leading-relaxed text-muted-foreground">{area.summary}</p>}
											<div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
												{area.agendas.map((agenda) => (
													<AgendaTile
														key={agenda.id}
														agenda={agenda}
														open={agenda.id === selectedId}
														picked={picked.has(agenda.id)}
														onOpen={() => setSelectedId(agenda.id)}
														onPick={() =>
															setPicked((prev) => {
																const next = new Set(prev);
																if (next.has(agenda.id)) next.delete(agenda.id);
																else next.add(agenda.id);
																return next;
															})
														}
													/>
												))}
											</div>
										</section>
									))}
								</div>
								<ChangesAndSources view={view} />
							</>
						)}
					</div>
				</div>

				{selected && (
					<AgendaPanel
						agenda={selected}
						goals={goals}
						post={post}
						onClose={() => setSelectedId(null)}
						onNavigate={(url) => router.push(url)}
					/>
				)}
			</div>
		</div>
	);
}

function HeaderButton({ onClick, icon, children, disabled }: { onClick: () => void; icon: React.ReactNode; children: React.ReactNode; disabled?: boolean }) {
	return (
		<button
			type="button"
			disabled={disabled}
			onClick={onClick}
			className="flex shrink-0 items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
		>
			{icon} {children}
		</button>
	);
}

function EmptyState({ onBuild, failed }: { onBuild: () => void; failed: boolean }) {
	return (
		<div className="mx-auto max-w-[36rem] space-y-3 py-10 text-sm leading-relaxed text-muted-foreground" data-testid="fieldmap-empty">
			<p className="text-foreground">Map the field of technical AI safety, and see where you stand in it.</p>
			<p>
				The map starts from the Shallow Review of Technical AI Safety 2025 (downloaded for your use, rewritten in the app's own words), then
				an agent checks it against newer sources. Each research agenda lists the key concepts it takes; your knowledge graph shows which
				you already know. It takes a few minutes and uses your models.
			</p>
			<button
				type="button"
				onClick={onBuild}
				data-testid="fieldmap-build"
				className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-foreground transition-colors hover:bg-accent"
			>
				<MapIcon className="size-3.5" /> {failed ? "Try building again" : "Build the map"}
			</button>
		</div>
	);
}

/** One stacked bar: known (solid), partly (light), not yet (outline). */
export function StandingBar({ row }: { row: Pick<StandingRow, "known" | "partly" | "total"> }) {
	const pct = (n: number) => (row.total === 0 ? 0 : (100 * n) / row.total);
	return (
		<div className="flex h-2 w-full overflow-hidden rounded-full border border-border/70" aria-hidden="true">
			<div className="h-full bg-foreground" style={{ width: `${pct(row.known)}%` }} />
			<div className="h-full bg-foreground/35" style={{ width: `${pct(row.partly)}%` }} />
		</div>
	);
}

function StandingPanel({
	view,
	picked,
	drillArea,
	onDrill,
	onClearPicked,
	onOpenAgenda,
}: {
	view: FieldMapView;
	picked: Set<string>;
	drillArea: string | null;
	onDrill: (id: string | null) => void;
	onClearPicked: () => void;
	onOpenAgenda: (id: string) => void;
}) {
	const mode = picked.size > 0 ? "picked" : drillArea ? "area" : "field";
	const rows = standing(view.areas, mode === "picked" ? { agendaIds: picked } : mode === "area" ? { areaId: drillArea! } : {});
	const totals = mode === "field" ? fieldTotals(view.areas) : rows.reduce((t, r) => ({ known: t.known + r.known, partly: t.partly + r.partly, total: t.total + r.total }), { known: 0, partly: 0, total: 0 });
	const areaTitle = view.areas.find((a) => a.id === drillArea)?.title;
	return (
		<section className="space-y-3 rounded-xl border border-border p-4" data-testid="fieldmap-standing">
			<div className="flex flex-wrap items-center gap-2">
				{mode === "area" && (
					<button type="button" onClick={() => onDrill(null)} aria-label="Back to the whole field" className="rounded-md p-0.5 text-muted-foreground hover:text-foreground">
						<ArrowLeftIcon className="size-3.5" />
					</button>
				)}
				<h2 className="text-xs uppercase tracking-widest text-muted-foreground">
					Where you stand — {mode === "field" ? "the whole field" : mode === "area" ? areaTitle : `your selection (${picked.size})`}
				</h2>
				{mode === "picked" && (
					<button type="button" onClick={onClearPicked} className="ml-auto text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
						Clear selection
					</button>
				)}
			</div>
			<p className="font-prose text-sm text-foreground/90">{totalsLine(totals)}</p>
			{view.coverageCheckedAt === null && <p className="text-xs text-muted-foreground">Checking against your knowledge graph…</p>}
			<div className="space-y-1.5">
				{rows.map((row) => (
					<button
						key={row.id}
						type="button"
						onClick={() => (mode === "field" ? onDrill(row.id) : onOpenAgenda(row.id))}
						className="grid w-full grid-cols-[minmax(0,14rem)_1fr_3.5rem] items-center gap-3 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-accent"
					>
						<span className="truncate text-xs text-foreground/90">{row.title}</span>
						<StandingBar row={row} />
						<span className="text-right text-[11px] tabular-nums text-muted-foreground">
							{row.known}/{row.total}
						</span>
					</button>
				))}
			</div>
			<p className="text-[11px] text-muted-foreground/70">
				{mode === "field" ? "Click an area to see its agendas · tick agendas below to compare a selection." : "Click an agenda for its details."} Solid: known · light: partly.
			</p>
		</section>
	);
}

function AgendaTile({ agenda, open, picked, onOpen, onPick }: { agenda: AgendaView; open: boolean; picked: boolean; onOpen: () => void; onPick: () => void }) {
	const share = agenda.total === 0 ? 0 : (agenda.known + 0.5 * agenda.partly) / agenda.total;
	return (
		<div
			data-testid={`agenda-${agenda.id}`}
			className={cn("relative rounded-lg border border-border/70 transition-colors", open && "ring-1 ring-foreground/50", agenda.status === "dormant" && "opacity-55")}
			style={{ backgroundColor: `color-mix(in oklab, var(--foreground) ${Math.round(share * 16)}%, transparent)` }}
		>
			<button type="button" onClick={onOpen} className="block w-full px-3 py-2 pr-8 text-left">
				<span className="block truncate text-sm text-foreground">{agenda.title}</span>
				<span className="block text-[11px] text-muted-foreground">
					{agenda.known}/{agenda.total} concepts known{agenda.status === "dormant" ? " · dormant" : ""}
				</span>
			</button>
			<button
				type="button"
				onClick={onPick}
				aria-label={picked ? `Remove ${agenda.title} from the comparison` : `Add ${agenda.title} to the comparison`}
				aria-pressed={picked}
				className={cn(
					"absolute right-2 top-2 flex size-4 items-center justify-center rounded border text-[10px] transition-colors",
					picked ? "border-foreground bg-foreground text-background" : "border-muted-foreground/50 text-transparent hover:border-foreground",
				)}
			>
				<CheckIcon className="size-3" />
			</button>
		</div>
	);
}

function AgendaPanel({
	agenda,
	goals,
	post,
	onClose,
	onNavigate,
}: {
	agenda: AgendaView & { areaTitle: string };
	goals: GoalSummary[];
	post: Post;
	onClose: () => void;
	onNavigate: (url: string) => void;
}) {
	const [picking, setPicking] = useState(false);
	const [sent, setSent] = useState<string | null>(null);
	const url = `/api/field-map/agendas/${agenda.id}`;
	useEffect(() => {
		setPicking(false);
		setSent(null);
	}, [agenda.id]);
	return (
		<aside className="flex w-[24rem] shrink-0 flex-col border-l border-border" data-testid="agenda-panel">
			<div className="flex items-start gap-2 border-b border-border px-4 py-3">
				<div className="min-w-0 flex-1">
					<div className="text-[11px] uppercase tracking-widest text-muted-foreground">{agenda.areaTitle}</div>
					<h2 className="font-prose text-lg leading-snug text-foreground">{agenda.title}</h2>
				</div>
				<button type="button" aria-label="Close" onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground">
					<XIcon className="size-4" />
				</button>
			</div>
			<div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3 text-sm">
				{agenda.status === "dormant" && <p className="text-xs text-muted-foreground">Marked dormant — little recent activity.</p>}
				<p className="leading-relaxed text-foreground/90">{agenda.summary}</p>
				<div>
					<div className="mb-1 text-[11px] uppercase tracking-widest text-muted-foreground">Why it would help</div>
					<p className="leading-relaxed text-muted-foreground">{agenda.theoryOfChange}</p>
				</div>
				<div>
					<div className="mb-1 flex items-baseline gap-2 text-[11px] uppercase tracking-widest text-muted-foreground">
						Key concepts
						<span className="normal-case tracking-normal">
							{agenda.known}/{agenda.total} known
						</span>
					</div>
					<ul className="space-y-1.5">
						{agenda.concepts.map((c, i) => {
							const status = agenda.conceptStatuses?.[i];
							return (
								<li key={i} className="flex gap-2 text-xs leading-relaxed">
									<span className="w-3 shrink-0 text-center text-muted-foreground" title={status ?? "not checked"}>
										{status ? MARK[status] : "–"}
									</span>
									<span className={cn(status === "held" ? "text-foreground/90" : "text-muted-foreground")}>{c}</span>
								</li>
							);
						})}
					</ul>
				</div>
			</div>
			<div className="space-y-1.5 border-t border-border px-4 py-3 text-xs">
				<PanelAction
					onClick={async () => {
						const data = await post({ action: "learn" }, url);
						if (data && typeof data.id === "string") onNavigate(`/chat/${data.id}?prompt=${encodeURIComponent(typeof data.prompt === "string" ? data.prompt : agenda.title)}`);
					}}
					icon={<PlayIcon className="size-3" />}
				>
					Learn this agenda
				</PanelAction>
				{goals.length > 0 && (
					<PanelAction onClick={() => setPicking((v) => !v)} icon={<MapIcon className="size-3" />}>
						Add to a roadmap
					</PanelAction>
				)}
				{picking && (
					<div className="ml-5 space-y-0.5">
						{goals.map((g) => (
							<button
								key={g.id}
								type="button"
								onClick={async () => {
									setPicking(false);
									if ((await post({ action: "roadmap", goalId: g.id }, url)) !== null) setSent(g.title);
								}}
								className="block w-full truncate rounded-md px-1.5 py-1 text-left text-foreground/90 transition-colors hover:bg-accent"
							>
								{g.title}
							</button>
						))}
					</div>
				)}
				{sent && <p className="ml-5 text-muted-foreground/70">Sent to {sent}</p>}
				<PanelAction
					onClick={async () => {
						const data = await post({ action: "goal" }, url);
						if (data && typeof data.goalId === "string") onNavigate(`/goals/${data.goalId}`);
					}}
					icon={<GraduationCapIcon className="size-3" />}
				>
					Make it a goal
				</PanelAction>
			</div>
		</aside>
	);
}

function PanelAction({ onClick, icon, children }: { onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
	return (
		<button type="button" onClick={onClick} className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
			{icon} {children}
		</button>
	);
}

function Proposals({ view, post }: { view: FieldMapView; post: Post }) {
	return (
		<section className="space-y-2 rounded-xl border border-dashed border-border p-4" data-testid="fieldmap-proposals">
			<h2 className="text-xs uppercase tracking-widest text-muted-foreground">Proposed changes</h2>
			{view.proposals.map((p) => (
				<div key={p.id} className="rounded-lg border border-border/60 px-3 py-2 text-xs">
					<div className="font-medium text-foreground/90">
						{p.kind === "add" ? `Add “${p.agenda?.title}” to ${p.areaTitle}` : p.kind === "edit" ? `Revise “${p.agenda?.title}”` : p.kind === "dormant" ? `Mark an agenda dormant (${p.areaTitle})` : `Remove an agenda (${p.areaTitle})`}
					</div>
					<p className="mt-0.5 leading-relaxed text-muted-foreground">{p.reason}</p>
					{p.sources.length > 0 && (
						<div className="mt-1 flex flex-wrap gap-x-2 text-[11px] text-muted-foreground/70">
							{p.sources.slice(0, 4).map((s) => (
								<a key={s} href={s} target="_blank" rel="noreferrer" className="truncate underline-offset-2 hover:underline">
									{s.replace(/^https?:\/\//, "").slice(0, 48)}
								</a>
							))}
						</div>
					)}
					<div className="mt-1.5 flex gap-1">
						<button type="button" onClick={() => void post({ action: "accept" }, `/api/field-map/proposals/${p.id}`)} className="flex items-center gap-1 rounded-md px-2 py-0.5 text-foreground transition-colors hover:bg-accent">
							<CheckIcon className="size-3" /> Accept
						</button>
						<button type="button" onClick={() => void post({ action: "reject" }, `/api/field-map/proposals/${p.id}`)} className="flex items-center gap-1 rounded-md px-2 py-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
							<XIcon className="size-3" /> Reject
						</button>
					</div>
				</div>
			))}
		</section>
	);
}

function ChangesAndSources({ view }: { view: FieldMapView }) {
	const [open, setOpen] = useState(false);
	return (
		<section className="space-y-2 border-t border-border pt-4 text-xs text-muted-foreground">
			<button type="button" onClick={() => setOpen((v) => !v)} className="underline-offset-2 hover:text-foreground hover:underline">
				{open ? "Hide" : "Show"} sources and what changed ({view.changes.length})
			</button>
			{open && (
				<div className="space-y-3">
					<div>
						<div className="mb-1 uppercase tracking-widest">Sources</div>
						<ul className="space-y-0.5">
							{view.sources.map((s) => (
								<li key={s.url}>
									<a href={s.url} target="_blank" rel="noreferrer" className="underline-offset-2 hover:text-foreground hover:underline">
										{s.title}
									</a>
								</li>
							))}
						</ul>
					</div>
					{view.changes.length > 0 && (
						<div>
							<div className="mb-1 uppercase tracking-widest">What changed</div>
							<ul className="space-y-1">
								{view.changes.map((c, i) => (
									<li key={i} className="leading-relaxed">
										<span className="text-muted-foreground/60">{c.at.slice(0, 10)}</span> {c.summary}
									</li>
								))}
							</ul>
						</div>
					)}
				</div>
			)}
		</section>
	);
}
