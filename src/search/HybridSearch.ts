import { dequantizeVector } from "../embeddings/Quantize";
import { NoteEntry, SearchResult } from "../types";
import { STRUCTURAL_WEIGHT, TOP_K } from "../constants";
import { EQUAL_WEIGHTS, StructuralWeights } from "./AdaptiveWeights";

function dot(a: number[] | Float32Array, b: number[] | Float32Array): number {
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

/**
 * A note's best-matching chunk against the query, by cosine similarity (both sides are
 * L2-normalized so a plain dot product is cosine similarity). Max rather than mean across
 * chunks: one strongly-matching section is exactly the signal we want, and averaging would
 * dilute a good match in a long note against its many less-relevant chunks (see
 * plans/v2-scale-first.md §4 Phase 1).
 */
function bestChunkScore(queryVec: number[], entry: NoteEntry): number {
	let best = 0;
	for (const chunk of entry.chunks) {
		const score = dot(queryVec, dequantizeVector(chunk.vector));
		if (score > best) best = score;
	}
	return best;
}

/**
 * Weighted combination of title/folder/tag hits, using per-vault weights derived from
 * VaultProfiler (defaults to equal thirds if none supplied) instead of v1's flat
 * Math.max(title, folder, tag*0.7) tuned against a single vault (plans/v2-scale-first.md
 * §4 Phase 2). Each input term is already a 0..1 fraction and the weights sum to 1, so the
 * result stays bounded to 0..1 -- same invariant the old Math.max version had.
 */
function structuralScore(
	queryTokens: string[],
	queryText: string,
	entry: NoteEntry,
	weights: StructuralWeights,
): number {
	const titleHit = wordOverlapFraction(tokenize(entry.title), new Set(queryTokens));
	const folderHit = entry.folderChain.length
		? Math.max(...entry.folderChain.map((f) => wordOverlapFraction(tokenize(f), new Set(queryTokens))))
		: 0;
	const q = queryText.toLowerCase();
	const tagHit = entry.tags.some((t) => t && q.includes(t.toLowerCase())) ? 1 : 0;
	return weights.title * titleHit + weights.folder * folderHit + weights.tag * tagHit;
}

export function search(
	queryVec: number[],
	queryText: string,
	entries: NoteEntry[],
	weights: StructuralWeights = EQUAL_WEIGHTS,
	topK = TOP_K,
): SearchResult[] {
	const queryTokens = tokenize(queryText);
	return entries
		.map((entry) => {
			const semantic = bestChunkScore(queryVec, entry);
			const structural = structuralScore(queryTokens, queryText, entry, weights);
			const score = (1 - STRUCTURAL_WEIGHT) * semantic + STRUCTURAL_WEIGHT * structural;
			return { entry, score };
		})
		.sort((a, b) => b.score - a.score)
		.slice(0, topK);
}
