import { NoteEntry } from "../types";

/** A candidate note as shown in the manual "Search notes instead" picker. `path` is the
 *  stable identity (titles can collide across folders -- see rankNoteMetadata below). */
export interface NotePickerItem {
	path: string;
	title: string;
}

/** `score` is a picker-local ranking value only -- never a confidence percentage, and never
 *  comparable to HybridSearch's semantic/structural score. */
export interface RankedNotePickerItem extends NotePickerItem {
	score: number;
}

const DEFAULT_LIMIT = 20;

// Tiers are spaced far enough apart that no fractional in-tier adjustment (see
// subsequenceScore, bounded to (0,1]) can cross into a neighboring tier.
const TIER_EXACT_TITLE = 60;
const TIER_TITLE_PREFIX = 50;
const TIER_TITLE_SUBSTRING = 40;
const TIER_PATH_SUBSTRING = 30;
const TIER_FUZZY_TITLE = 20; // + subsequenceScore() fraction, range (20, 21]
const TIER_FUZZY_PATH = 10; // + subsequenceScore() fraction, range (10, 11]
/** All query tokens matched *something* (substring or subsequence) individually, but not as
 *  one ordered phrase anywhere -- still a legitimate hit, just the weakest one we keep. */
const TIER_TOKEN_ONLY = 1;

/** trim + collapse whitespace + lowercase + strip diacritics. Never applied to displayed
 *  title/path -- only to the copies used for matching/scoring. */
function normalize(text: string): string {
	return text
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "") // strip combining diacritical marks after NFD decomposition
		.toLowerCase()
		.trim()
		.replace(/\s+/g, " ");
}

/** `NoteEntry.title` is expected non-empty, but score defensively against malformed cache
 *  entries (Failure handling: "treat missing title defensively... do not alter the cache
 *  schema") by falling back to the path's filename stem. */
function displayTitle(entry: NoteEntry): string {
	const title = entry.title?.trim();
	if (title) return title;
	const stem = entry.path.split("/").pop() ?? entry.path;
	return stem.replace(/\.md$/i, "") || entry.path;
}

/**
 * Ordered-subsequence match: every character of `needle` appears in `haystack` in order (not
 * necessarily contiguous). Returns null if `needle` isn't a subsequence of `haystack` at all,
 * otherwise a (0,1] score that rewards a tight span (few gaps) and a short haystack relative
 * to the needle -- i.e. "typed a recognizable, non-arbitrary fragment of this exact title."
 */
function subsequenceScore(needle: string, haystack: string): number | null {
	if (needle.length === 0 || haystack.length === 0) return null;
	let ni = 0;
	let prevIndex = -1;
	let gaps = 0;
	for (let hi = 0; hi < haystack.length && ni < needle.length; hi++) {
		if (haystack[hi] === needle[ni]) {
			if (prevIndex !== -1) gaps += hi - prevIndex - 1;
			prevIndex = hi;
			ni++;
		}
	}
	if (ni < needle.length) return null;
	const gapFactor = 1 / (1 + gaps);
	const lengthFactor = needle.length / Math.max(haystack.length, needle.length);
	return gapFactor * (0.4 + 0.6 * lengthFactor);
}

function tokenMatches(token: string, titleNorm: string, pathNorm: string): boolean {
	if (titleNorm.includes(token) || pathNorm.includes(token)) return true;
	return subsequenceScore(token, titleNorm) !== null || subsequenceScore(token, pathNorm) !== null;
}

/** Returns null if this entry should be excluded outright (some query token matched nothing),
 *  otherwise a tiered score -- see the TIER_* constants above. */
function scoreEntry(queryNorm: string, tokens: string[], titleNorm: string, pathNorm: string): number | null {
	// Every non-empty token must independently match somewhere (title or path, substring or
	// ordered-subsequence) -- keeps typo tolerance bounded instead of admitting arbitrary weak
	// matches for multi-word queries (see brief §"Chosen approach").
	for (const token of tokens) {
		if (!tokenMatches(token, titleNorm, pathNorm)) return null;
	}

	if (titleNorm === queryNorm) return TIER_EXACT_TITLE;
	if (titleNorm.startsWith(queryNorm)) return TIER_TITLE_PREFIX;
	if (titleNorm.includes(queryNorm)) return TIER_TITLE_SUBSTRING;
	if (pathNorm.includes(queryNorm)) return TIER_PATH_SUBSTRING;

	const titleFuzzy = subsequenceScore(queryNorm, titleNorm);
	if (titleFuzzy !== null) return TIER_FUZZY_TITLE + titleFuzzy;
	const pathFuzzy = subsequenceScore(queryNorm, pathNorm);
	if (pathFuzzy !== null) return TIER_FUZZY_PATH + pathFuzzy;

	// Tokens gated individually (e.g. a scattered multi-word query) but the full query string
	// isn't an ordered match anywhere -- still worth surfacing, just ranked last.
	return TIER_TOKEN_ONLY;
}

/**
 * Deterministic, dependency-free ranking of indexed notes by title/path metadata only -- no
 * embeddings, no HybridSearch, no vault-content reads (see CLAUDE.md local-only constraints
 * and the manual-override brief's "Chosen approach"). Returns `[]` for an empty/whitespace
 * query; never returns more than `limit` results.
 */
export function rankNoteMetadata(
	query: string,
	entries: readonly NoteEntry[],
	limit: number = DEFAULT_LIMIT,
): RankedNotePickerItem[] {
	const queryNorm = normalize(query);
	if (!queryNorm) return [];
	const tokens = queryNorm.split(" ").filter(Boolean);

	const ranked: RankedNotePickerItem[] = [];
	for (const entry of entries) {
		const title = displayTitle(entry);
		const titleNorm = normalize(title);
		const pathNorm = normalize(entry.path);
		const score = scoreEntry(queryNorm, tokens, titleNorm, pathNorm);
		if (score === null) continue;
		ranked.push({ path: entry.path, title, score });
	}

	ranked.sort((a, b) => {
		if (b.score !== a.score) return b.score - a.score;
		const titleCmp = normalize(a.title).localeCompare(normalize(b.title));
		if (titleCmp !== 0) return titleCmp;
		return normalize(a.path).localeCompare(normalize(b.path));
	});

	return ranked.slice(0, Math.max(0, limit));
}
