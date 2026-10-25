/**
 * Papers + the feed (forks #8, #9 — docs/papers-feed.md).
 *
 * Papers live on the Library's Papers shelf: a lightweight record (no book
 * map) + a PDF copy. A paper session is a NORMAL teach session shaped by a
 * paper-context first message (depth: skim / standard / deep). Predictions
 * committed in Standard/Deep sessions are recorded on the paper — the
 * research-taste calibration record.
 *
 * The feed is a daily, forgiving shortlist (top 5) of new arXiv papers and
 * lab research posts ranked for the learner; items expire after 7 days and
 * nothing is ever counted.
 */

export type PaperDepth = "skim" | "standard" | "deep";
export const PAPER_DEPTHS: readonly PaperDepth[] = ["skim", "standard", "deep"];

export type PredictionOutcome = "held" | "partly" | "missed";

export interface PaperPrediction {
	id: string;
	/** The session it was committed in. */
	chatId: string;
	statement: string;
	/** 50–99 — how sure the learner was. */
	confidence: number;
	outcome?: PredictionOutcome;
	createdAt: string;
	resolvedAt?: string;
}

/** data/library/papers/<id>/paper.json */
export interface PaperRecord {
	id: string;
	title: string;
	authors: string[];
	/** "2203.02155" — present for arXiv papers. */
	arxivId?: string;
	abstract: string;
	source: { kind: "arxiv" | "url" | "file"; name: string };
	/** pdf — read through the PDF reader (consult_book); article — a web post
	 *  saved as readable text (paper.md), given to the session directly. */
	format: "pdf" | "article";
	/** PDF pages (0 for articles). */
	pageCount: number;
	addedAt: string;
	updatedAt: string;
	predictions: PaperPrediction[];
	version?: number;
}

export const CURRENT_PAPER_VERSION = 1;

export interface PaperSummary {
	id: string;
	title: string;
	authors: string[];
	arxivId?: string;
	addedAt: string;
	predictions: number;
	sessions: number;
}

export interface PaperView extends PaperSummary {
	abstract: string;
	source: PaperRecord["source"];
	format: PaperRecord["format"];
	pageCount: number;
	predictionList: PaperPrediction[];
	sessionList: { id: string; title: string; updatedAt: string }[];
}

/** The paper-context marker's UI payload. */
export interface PaperContextDetails {
	paperId: string;
	paperTitle: string;
	depth: PaperDepth;
}

// ─── calibration ─────────────────────────────────────────────────────────────

export interface CalibrationBand {
	/** "50–59%" … "90–99%" */
	label: string;
	low: number;
	high: number;
	calls: number;
	held: number;
	partly: number;
	missed: number;
	/** Held + half of partly, over resolved calls (null with none). */
	hitRate: number | null;
}

/** Resolved predictions grouped into 10-point confidence bands. */
export function calibrationBands(predictions: readonly Pick<PaperPrediction, "confidence" | "outcome">[]): CalibrationBand[] {
	const bands: CalibrationBand[] = [50, 60, 70, 80, 90].map((low) => ({
		label: `${low}–${low + 9}%`,
		low,
		high: low + 9,
		calls: 0,
		held: 0,
		partly: 0,
		missed: 0,
		hitRate: null,
	}));
	for (const p of predictions) {
		if (!p.outcome) continue;
		const band = bands.find((b) => p.confidence >= b.low && p.confidence <= b.high) ?? (p.confidence < 50 ? bands[0] : bands[4]);
		if (!band) continue;
		band.calls++;
		band[p.outcome]++;
	}
	for (const b of bands) b.hitRate = b.calls === 0 ? null : (b.held + 0.5 * b.partly) / b.calls;
	return bands;
}

// ─── the feed ────────────────────────────────────────────────────────────────

export type FeedSourceKind = "arxiv" | "rss" | "page";

export interface FeedItem {
	id: string;
	url: string;
	title: string;
	/** The source's label ("arXiv", "OpenAI", "METR"…). */
	source: string;
	kind: FeedSourceKind;
	/** Publication date when the source gives one, else when first seen. */
	publishedAt: string;
	/** One line on what it is. */
	summary: string;
	/** One line on why it's relevant to this learner. */
	why: string;
	arxivId?: string;
	/** When it entered the shortlist (expiry runs from here). */
	addedAt: string;
	status: "shown" | "dismissed" | "added";
	/** The paper it became (Read it / Add to papers). */
	paperId?: string;
}

/** data/library/feed.json */
export interface FeedRecord {
	version?: number;
	/** "YYYY-MM-DD" of the last scan (the once-a-day gate). */
	lastScanDay?: string;
	lastScanAt?: string;
	error?: string;
	items: FeedItem[];
	/** URLs already considered (never shown twice); capped. */
	seen: string[];
}

export const FEED_KEEP_DAYS = 7;
export const FEED_DAILY_PICKS = 5;

export interface FeedView {
	items: FeedItem[];
	lastScanAt: string | null;
	working: boolean;
	error?: string;
}

/** Shown items, newest first, within the keep window (pure). */
export function visibleFeedItems(items: readonly FeedItem[], now: Date = new Date()): FeedItem[] {
	const cutoff = now.getTime() - FEED_KEEP_DAYS * 86_400_000;
	return items
		.filter((i) => i.status !== "dismissed" && new Date(i.addedAt).getTime() >= cutoff)
		.sort((a, b) => b.addedAt.localeCompare(a.addedAt) || a.title.localeCompare(b.title));
}
