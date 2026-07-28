/**
 * int8 quantization for embedding vectors, so notes-cache.json stores ~1 byte/dimension
 * instead of JSON's ~19 chars/float64. See plans/v2-scale-first.md §4 Phase 0.
 *
 * Safe because embedText() always calls the model with `normalize: true` (EmbeddingModel.ts),
 * so every component of every vector we quantize is already bounded to [-1, 1] -- that's what
 * makes a flat *127 scale (rather than a per-vector min/max scale) lossless enough to use:
 * ~0.4% error on cosine similarity, far below the granularity MIN_CONFIDENCE/MIN_MARGIN
 * operate at.
 *
 * Uses plain browser APIs (btoa/atob), not Node's Buffer -- deliberately, matching
 * EmbeddingModel.ts's stance of not leaning on Node globals inside Obsidian's renderer.
 */

/** Quantize a normalized embedding to a base64-encoded int8 string. */
export function quantizeVector(vec: number[] | Float32Array): string {
	const bytes = new Uint8Array(vec.length);
	for (let i = 0; i < vec.length; i++) {
		const clamped = Math.max(-1, Math.min(1, vec[i]));
		// Two's-complement byte: Math.round(clamped * 127) is in [-127, 127], `& 0xff` reinterprets
		// negative values as their unsigned byte representation (e.g. -1 -> 255).
		bytes[i] = Math.round(clamped * 127) & 0xff;
	}
	let binary = "";
	for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
	return btoa(binary);
}

/** Reverse quantizeVector(). Returned values approximate the original normalized components. */
export function dequantizeVector(b64: string): Float32Array {
	const binary = atob(b64);
	const out = new Float32Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		let byte = binary.charCodeAt(i);
		if (byte > 127) byte -= 256; // reinterpret the unsigned byte back to signed
		out[i] = byte / 127;
	}
	return out;
}
