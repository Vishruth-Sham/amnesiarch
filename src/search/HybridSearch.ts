import { NoteEntry, SearchResult } from "../types";
import { STRUCTURAL_WEIGHT, TOP_K } from "../constants";

function dot(a: number[], b: number[]): number {
	let sum = 0;
	for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
	return sum;
}

function tokenize(text: string): string[] {
	return text
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter((t) => t.length > 1);
}

/** Fraction of `needle`'s tokens that appear in `haystackTokens`. 0..1. */
function wordOverlapFraction(needleTokens: string[], haystackTokens: Set<string>): number {
	if (needleTokens.length === 0) return 0;
	const hits = needleTokens.filter((t) => haystackTokens.has(t)).length;
	return hits / needleTokens.length;
}

function structuralScore(queryTokens: string[], queryText: string, entry: NoteEntry): number {
	const titleHit = wordOverlapFraction(tokenize(entry.title), new Set(queryTokens));
	const folderHit = entry.folderChain.length
		? Math.max(...entry.folderChain.map((f) => wordOverlapFraction(tokenize(f), new Set(queryTokens))))
		: 0;
	const q = queryText.toLowerCase();
	const tagHit = entry.tags.some((t) => t && q.includes(t.toLowerCase())) ? 1 : 0;
	return Math.max(titleHit, folderHit, tagHit * 0.7);
}

export function search(queryVec: number[], queryText: string, entries: NoteEntry[], topK = TOP_K): SearchResult[] {
	const queryTokens = tokenize(queryText);
	return entries
		.map((entry) => {
			const semantic = dot(queryVec, entry.embedding);
			const structural = structuralScore(queryTokens, queryText, entry);
			const score = (1 - STRUCTURAL_WEIGHT) * semantic + STRUCTURAL_WEIGHT * structural;
			return { entry, score };
		})
		.sort((a, b) => b.score - a.score)
		.slice(0, topK);
}
