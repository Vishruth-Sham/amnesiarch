/**
 * Deterministic stand-in for src/embeddings/EmbeddingModel.embedText(), used everywhere the real
 * one (a HuggingFace transformers.js pipeline -- slow, network-dependent, and never appropriate
 * to run for real in CI) would otherwise be invoked. Same contract as the real thing: an
 * EMBEDDING_DIM-length, L2-normalized vector (see src/embeddings/Quantize.ts and
 * src/search/HybridSearch.ts's dot()-as-cosine-similarity, both of which assume normalize:true).
 *
 * Every occurrence of a given token maps to the exact same pseudo-random unit vector everywhere
 * (memoized), so two texts sharing vocabulary produce measurably similar document vectors and
 * two texts with disjoint vocabularies land near-orthogonal -- the property the search-ranking
 * integration tests rely on to make "does it rank the right note higher" assertions meaningful.
 */

const EMBEDDING_DIM = 384;

function tokenize(text: string): string[] {
	return text
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter((t) => t.length > 1);
}

// mulberry32: tiny seeded PRNG, good enough for generating a stable pseudo-random unit vector
// per token -- no need for real cryptographic randomness here.
function mulberry32(seed: number): () => number {
	let a = seed;
	return () => {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

// FNV-1a: cheap, deterministic string -> 32-bit int hash, used only to seed the PRNG above.
function fnv1a(str: string): number {
	let hash = 0x811c9dc5;
	for (let i = 0; i < str.length; i++) {
		hash ^= str.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return hash >>> 0;
}

function normalize(vec: Float64Array): number[] {
	let norm = 0;
	for (let i = 0; i < vec.length; i++) norm += vec[i] * vec[i];
	norm = Math.sqrt(norm) || 1;
	return Array.from(vec, (v) => v / norm);
}

const tokenVectorCache = new Map<string, number[]>();

function tokenVector(token: string, dim: number): number[] {
	const cached = tokenVectorCache.get(token);
	if (cached) return cached;
	const rand = mulberry32(fnv1a(token));
	const raw = new Float64Array(dim);
	for (let i = 0; i < dim; i++) raw[i] = rand() * 2 - 1;
	const vec = normalize(raw);
	tokenVectorCache.set(token, vec);
	return vec;
}

export function fakeEmbed(text: string, dim = EMBEDDING_DIM): number[] {
	const tokens = tokenize(text);
	if (tokens.length === 0) {
		// Deterministic but non-zero fallback for empty/whitespace-only input, so it still
		// L2-normalizes to a valid unit vector rather than dividing by zero.
		return normalize(Float64Array.from(tokenVector("__empty__", dim)));
	}
	const sum = new Float64Array(dim);
	for (const token of tokens) {
		const vec = tokenVector(token, dim);
		for (let i = 0; i < dim; i++) sum[i] += vec[i];
	}
	return normalize(sum);
}

export async function fakeEmbedText(text: string): Promise<number[]> {
	return fakeEmbed(text);
}
