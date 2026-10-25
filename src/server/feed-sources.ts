/**
 * The feed's sources + parsers (fork #9 — docs/papers-feed.md): server-only
 * (linkedom). Three kinds of source:
 *   arxiv — the arXiv API (Atom), new submissions in cs.LG/cs.CL/cs.AI
 *   rss   — RSS 2.0 or Atom feeds (OpenAI, DeepMind, Redwood, METR)
 *   page  — listing pages without RSS (Anthropic, Apollo, UK AISI): article
 *           links matched by a path pattern, dated when first seen, titled
 *           from the article page's own metadata
 * Parsers are pure over the fetched text (tested on fixed samples); network
 * access goes through the injectable `feedFetch`.
 */

import { DOMParser, parseHTML } from "linkedom";

export interface FeedSource {
	id: string;
	label: string;
	kind: "arxiv" | "rss" | "page";
	url: string;
	/** page sources: which hrefs are articles. */
	linkPattern?: RegExp;
}

export const ARXIV_CATEGORIES = ["cs.LG", "cs.CL", "cs.AI"];

export const FEED_SOURCES: readonly FeedSource[] = [
	{
		id: "arxiv",
		label: "arXiv",
		kind: "arxiv",
		url: `https://export.arxiv.org/api/query?search_query=${ARXIV_CATEGORIES.map((c) => `cat:${c}`).join("+OR+")}&sortBy=submittedDate&sortOrder=descending&max_results=300`,
	},
	{ id: "openai", label: "OpenAI", kind: "rss", url: "https://openai.com/news/rss.xml" },
	{ id: "deepmind", label: "Google DeepMind", kind: "rss", url: "https://deepmind.google/blog/rss.xml" },
	{ id: "redwood", label: "Redwood Research", kind: "rss", url: "https://blog.redwoodresearch.org/feed" },
	{ id: "metr", label: "METR", kind: "rss", url: "https://metr.org/feed.xml" },
	{ id: "anthropic", label: "Anthropic", kind: "page", url: "https://www.anthropic.com/research", linkPattern: /^\/research\/[a-z0-9-]+$/ },
	{ id: "anthropic-alignment", label: "Anthropic Alignment Science", kind: "page", url: "https://alignment.anthropic.com/", linkPattern: /^\/?20\d\d\/[a-z0-9-]+\/(index\.html)?$/ },
	{ id: "apollo", label: "Apollo Research", kind: "page", url: "https://www.apolloresearch.ai/research", linkPattern: /^https:\/\/www\.apolloresearch\.ai\/(blog|research)\/[a-z0-9-]+$/ },
	{ id: "aisi", label: "UK AISI", kind: "page", url: "https://www.aisi.gov.uk/work", linkPattern: /^\/(blog|work|research)\/[a-z0-9-]+$/ },
];

/** A raw item before ranking. */
export interface RawFeedItem {
	url: string;
	title: string;
	summary: string;
	/** ISO date, or null when the source doesn't give one. */
	publishedAt: string | null;
	arxivId?: string;
	authors?: string[];
}

/** Injectable for tests. */
export const feedFetch: { current: (url: string) => Promise<string> } = {
	current: async (url) => {
		const res = await fetch(url, {
			signal: AbortSignal.timeout(30_000),
			headers: { "User-Agent": "Mozilla/5.0 (LearnHarness feed)", Accept: "application/atom+xml,application/rss+xml,application/xml,text/html,*/*" },
		});
		if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
		return res.text();
	},
};

const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

/** Strip markup from an RSS description. */
function plainText(html: string): string {
	if (!html.includes("<")) return clean(html);
	const { document } = parseHTML(`<!doctype html><html><body>${html}</body></html>`);
	return clean(document.body?.textContent);
}

function isoOrNull(s: string | null | undefined): string | null {
	if (!s) return null;
	const t = Date.parse(s.trim());
	return Number.isNaN(t) ? null : new Date(t).toISOString();
}

function xml(text: string) {
	return new DOMParser().parseFromString(text, "text/xml");
}

/** arXiv API Atom → items (abs URL, title, abstract, date, authors, id). */
export function parseArxivAtom(text: string): RawFeedItem[] {
	const doc = xml(text);
	return [...doc.querySelectorAll("entry")].map((e) => {
		const idUrl = clean(e.querySelector("id")?.textContent);
		const arxivId = idUrl.match(/(\d{4}\.\d{4,5})/)?.[1];
		return {
			url: arxivId ? `https://arxiv.org/abs/${arxivId}` : idUrl,
			title: clean(e.querySelector("title")?.textContent),
			summary: clean(e.querySelector("summary")?.textContent),
			publishedAt: isoOrNull(e.querySelector("published")?.textContent),
			...(arxivId ? { arxivId } : {}),
			authors: [...e.querySelectorAll("author name")].map((n) => clean(n.textContent)).filter(Boolean),
		};
	}).filter((i) => i.title && i.url);
}

/** RSS 2.0 <item>s or Atom <entry>s → items. */
export function parseRss(text: string): RawFeedItem[] {
	const doc = xml(text);
	const rss = [...doc.querySelectorAll("item")].map((i) => ({
		url: clean(i.querySelector("link")?.textContent),
		title: clean(i.querySelector("title")?.textContent),
		summary: plainText(i.querySelector("description")?.textContent ?? "").slice(0, 600),
		publishedAt: isoOrNull(i.querySelector("pubDate")?.textContent ?? i.querySelector("date")?.textContent),
	}));
	const atom = [...doc.querySelectorAll("entry")].map((e) => {
		const link = [...e.querySelectorAll("link")].find((l) => !l.getAttribute("rel") || l.getAttribute("rel") === "alternate");
		return {
			url: clean(link?.getAttribute("href")),
			title: clean(e.querySelector("title")?.textContent),
			summary: plainText(e.querySelector("summary")?.textContent ?? e.querySelector("content")?.textContent ?? "").slice(0, 600),
			publishedAt: isoOrNull(e.querySelector("published")?.textContent ?? e.querySelector("updated")?.textContent),
		};
	});
	return [...rss, ...atom].filter((i) => i.title && /^https?:\/\//.test(i.url));
}

/** Article links on a listing page (absolute, deduped, in page order). */
export function listingLinks(html: string, pageUrl: string, pattern: RegExp): string[] {
	const { document } = parseHTML(html);
	const out: string[] = [];
	const seen = new Set<string>();
	for (const a of [...document.querySelectorAll("a[href]")]) {
		const href = (a.getAttribute("href") ?? "").split("#")[0]!.split("?")[0]!;
		if (!pattern.test(href)) continue;
		let abs: string;
		try {
			abs = new URL(href, pageUrl).toString();
		} catch {
			continue;
		}
		if (!seen.has(abs)) {
			seen.add(abs);
			out.push(abs);
		}
	}
	return out;
}

/** An article page's title + description (og: first, then <title>/meta). */
export function pageMeta(html: string): { title: string; summary: string } {
	const { document } = parseHTML(html);
	const meta = (sel: string) => clean(document.querySelector(sel)?.getAttribute("content"));
	// Site suffixes ("… | AISI Work", "… - Apollo Research") add nothing.
	const title = (meta('meta[property="og:title"]') || clean(document.querySelector("title")?.textContent)).replace(/\s+[|–—-]\s+[^|–—-]{2,40}$/, "");
	const summary = meta('meta[property="og:description"]') || meta('meta[name="description"]');
	return { title, summary };
}

/** One paper's arXiv metadata (title, authors, abstract). */
export async function arxivMetadata(arxivId: string): Promise<RawFeedItem | null> {
	const [item] = parseArxivAtom(await feedFetch.current(`https://export.arxiv.org/api/query?id_list=${encodeURIComponent(arxivId)}`));
	return item ?? null;
}

/** Fetch one source → raw items. Page sources only return links not yet
 *  seen, titled from each article's own page (a handful per day). */
export async function fetchSource(source: FeedSource, seen: ReadonlySet<string>): Promise<RawFeedItem[]> {
	const text = await feedFetch.current(source.url);
	if (source.kind === "arxiv") return parseArxivAtom(text);
	if (source.kind === "rss") return parseRss(text);
	const links = listingLinks(text, source.url, source.linkPattern!).filter((u) => !seen.has(u)).slice(0, 12);
	const items: RawFeedItem[] = [];
	for (const url of links) {
		try {
			const meta = pageMeta(await feedFetch.current(url));
			if (meta.title) items.push({ url, title: meta.title, summary: meta.summary, publishedAt: null });
		} catch {
			// one unreadable article never sinks the source
		}
	}
	return items;
}
