/**
 * Library folds (fork #15 — docs/library.md): pure, browser-safe.
 *   - outline normalization: flat bookmarks/TOC entries → chapters → sections
 *     with inclusive page ranges
 *   - coverage roll-up: idea statuses → a section's covered/partly/not-yet
 *   - candidate selection: the graph propositions worth showing the judge
 *     for one idea (cheap lexical overlap, so the model call stays small)
 *   - the book outline text the agents read (vocabulary, never a plan)
 */
import type {
	BookChapter,
	BookCoverage,
	BookRecord,
	ChapterView,
	IdeaStatus,
	SectionCoverage,
	SectionView,
} from "./contracts/library.ts";
import { topicSlug } from "./contracts/goals.ts";

export interface OutlineEntry {
	title: string;
	/** 1 = chapter, 2 = section. */
	level: number;
	/** 1-indexed page; entries without one are dropped. */
	page: number | null;
}

/**
 * Build chapters from flat entries. Each entry runs to the page before the
 * next entry of the same or higher level (the last to the end of the book).
 * A chapter with no level-2 entries is its own single section. Ids are
 * stable slugs (deduped with a counter).
 */
export function chaptersFromOutline(entries: readonly OutlineEntry[], pageCount: number): BookChapter[] {
	const valid = entries
		.filter((e) => e.page !== null && e.page >= 1 && e.page <= pageCount && e.title.trim())
		.map((e) => ({ title: e.title.trim(), level: e.level <= 1 ? 1 : 2, page: e.page! }));
	// Keep reading order but drop entries that jump backwards (broken outlines).
	const ordered: typeof valid = [];
	for (const e of valid) if (ordered.length === 0 || e.page >= ordered[ordered.length - 1]!.page) ordered.push(e);
	// A book whose outline has only level-2 entries: promote them.
	if (!ordered.some((e) => e.level === 1)) for (const e of ordered) e.level = 1;

	const used = new Set<string>();
	const idFor = (title: string): string => {
		const base = topicSlug(title);
		let id = base;
		for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
		used.add(id);
		return id;
	};
	const endOf = (i: number, level: number): number => {
		for (let j = i + 1; j < ordered.length; j++) {
			if (ordered[j]!.level <= level) return Math.max(ordered[i]!.page, ordered[j]!.page - 1);
		}
		return pageCount;
	};

	const chapters: BookChapter[] = [];
	ordered.forEach((e, i) => {
		if (e.level === 1) {
			chapters.push({ id: idFor(e.title), title: e.title, startPage: e.page, endPage: endOf(i, 1), sections: [] });
			return;
		}
		const chapter = chapters[chapters.length - 1];
		if (!chapter) return; // a section before any chapter (front matter) — skipped
		chapter.sections.push({ id: idFor(`${chapter.title} ${e.title}`), title: e.title, startPage: e.page, endPage: Math.min(endOf(i, 2), chapter.endPage), ideas: [] });
	});
	for (const c of chapters) {
		if (c.sections.length === 0) {
			c.sections.push({ id: idFor(`${c.title} section`), title: c.title, startPage: c.startPage, endPage: c.endPage, ideas: [] });
		} else if (c.sections[0]!.startPage > c.startPage) {
			// The chapter's opening pages before its first section: an intro section.
			c.sections.unshift({ id: idFor(`${c.title} intro`), title: `${c.title} (introduction)`, startPage: c.startPage, endPage: c.sections[0]!.startPage - 1, ideas: [] });
		}
	}
	return chapters;
}

/** A section is covered when its ideas are mostly held (partly = half). */
export const COVERED_THRESHOLD = 0.75;

export function sectionCoverage(statuses: readonly IdeaStatus[] | null | undefined): SectionCoverage {
	if (!statuses || statuses.length === 0) return "unknown";
	const score = statuses.reduce((n, s) => n + (s === "held" ? 1 : s === "partly" ? 0.5 : 0), 0) / statuses.length;
	if (score >= COVERED_THRESHOLD) return "covered";
	return score > 0 ? "partly" : "not-yet";
}

export function chapterViews(chapters: readonly BookChapter[], coverage: BookCoverage | null): ChapterView[] {
	return chapters.map((c) => {
		const sections: SectionView[] = c.sections.map((s) => {
			const statuses = coverage?.ideas[s.id] ?? null;
			const aligned = statuses && statuses.length === s.ideas.length ? statuses : null;
			return { ...s, ideaStatuses: aligned, coverage: sectionCoverage(aligned) };
		});
		return { ...c, sections, coveredSections: sections.filter((s) => s.coverage === "covered").length };
	});
}

export function allSections(book: Pick<BookRecord, "chapters">) {
	return book.chapters.flatMap((c) => c.sections);
}

// ─── candidate selection for the coverage judge ──────────────────────────────

const STOP = new Set(
	"the and for with that this from into over under about which their there these those what when where while your have been being than then they them also such only more most very each other between within without using used".split(" "),
);

export function tokens(text: string): Set<string> {
	return new Set(
		text
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, " ")
			.split(" ")
			.filter((w) => w.length > 2 && !STOP.has(w)),
	);
}

/** The `max` graph propositions sharing the most words with the idea
 *  (ties keep graph order); zero-overlap nodes are never candidates. */
export function ideaCandidates<N extends { id: string; name: string; statement: string }>(idea: string, nodes: readonly N[], max = 8): N[] {
	const want = tokens(idea);
	if (want.size === 0) return [];
	return nodes
		.map((n, i) => {
			const have = tokens(`${n.name} ${n.statement}`);
			let overlap = 0;
			for (const w of want) if (have.has(w)) overlap++;
			return { n, i, overlap };
		})
		.filter((x) => x.overlap > 0)
		.sort((a, b) => b.overlap - a.overlap || a.i - b.i)
		.slice(0, max)
		.map((x) => x.n);
}

/** The book's outline for agents: titles + pages only — vocabulary for the
 *  prober/teacher, a page index for the reader. Never key ideas, never a
 *  plan (the guardrail). */
export function outlineText(book: Pick<BookRecord, "title" | "chapters">, maxChars = 6000): string {
	const lines = [`${book.title}`];
	for (const c of book.chapters) {
		lines.push(`- ${c.title} (pp. ${c.startPage}–${c.endPage})`);
		if (c.sections.length > 1) for (const s of c.sections) lines.push(`    - ${s.title} (pp. ${s.startPage}–${s.endPage})`);
	}
	const text = lines.join("\n");
	return text.length > maxChars ? `${text.slice(0, maxChars)}\n…` : text;
}
