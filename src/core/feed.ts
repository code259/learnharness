/**
 * The feed's free ranking stage (fork #9 — docs/papers-feed.md): pure,
 * browser-safe. arXiv items pass a safety-terms filter; every candidate is
 * scored by word overlap with the learner's interest profile (active goals'
 * topics, field-map agendas, graph propositions). The top ~30 go to ONE
 * cheap model call that picks 5 and says why.
 */
import { tokens } from "./library.ts";

/** Words/stems that mark an arXiv paper as AI-safety-adjacent (matched as
 *  substrings of the lowercase title + abstract). */
export const SAFETY_TERMS = [
	"alignment", "align ", "aligned", "safety", "safe ", "interpretab", "mechanistic", "sparse autoencoder", "superposition",
	"reward hack", "reward model", "rlhf", "preference", "constitutional", "oversight", "scalable oversight", "debate",
	"deception", "deceptive", "scheming", "sandbag", "sycophan", "jailbreak", "red team", "red-team", "adversarial",
	"misalign", "monitor", "chain-of-thought faithful", "faithfulness", "steering", "activation", "probing", "unlearning",
	"backdoor", "sleeper", "situational awareness", "dangerous capabilit", "evaluation of frontier", "control protocol",
	"ai control", "corrigib", "persona", "emergent misalignment", "model organism", "power-seeking", "honesty", "truthful",
];

export function safetyRelevant(text: string): boolean {
	const t = ` ${text.toLowerCase().replace(/\s+/g, " ")} `;
	return SAFETY_TERMS.some((term) => t.includes(term));
}

/** Word weights from the learner's profile texts: a word's weight is how
 *  many profile texts mention it (capped), so shared themes rank higher. */
export function profileWeights(texts: readonly string[]): Map<string, number> {
	const weights = new Map<string, number>();
	for (const text of texts) for (const w of tokens(text)) weights.set(w, Math.min(5, (weights.get(w) ?? 0) + 1));
	return weights;
}

/** Overlap score: title words count double; normalized by length so long
 *  abstracts don't win on volume. */
export function prefilterScore(item: { title: string; summary: string }, weights: ReadonlyMap<string, number>): number {
	let score = 0;
	for (const w of tokens(item.title)) score += 2 * (weights.get(w) ?? 0);
	const body = tokens(item.summary);
	for (const w of body) score += weights.get(w) ?? 0;
	return score / Math.sqrt(4 + body.size);
}

/** The top `n` by score (ties keep input order); zero scores dropped unless
 *  the pool would otherwise be empty (a fresh learner still gets a feed). */
export function prefilter<T extends { title: string; summary: string }>(items: readonly T[], weights: ReadonlyMap<string, number>, n = 30): T[] {
	const scored = items.map((item, i) => ({ item, i, score: prefilterScore(item, weights) }));
	const positive = scored.filter((s) => s.score > 0);
	const pool = positive.length > 0 ? positive : scored;
	return pool
		.sort((a, b) => b.score - a.score || a.i - b.i)
		.slice(0, n)
		.map((s) => s.item);
}

/** "2203.02155" from an arXiv URL or a bare id (versions stripped). */
export function arxivIdOf(ref: string): string | null {
	const m = ref.trim().match(/(?:arxiv\.org\/(?:abs|pdf)\/)?(\d{4}\.\d{4,5})(?:v\d+)?(?:\.pdf)?\/?$/i);
	return m ? m[1]! : null;
}
