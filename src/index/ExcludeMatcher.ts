/**
 * Deliberately not a full glob implementation -- that would mean a new dependency for a
 * feature that just needs "skip this folder". A pattern matches a path if the path is exactly
 * the pattern, or sits under it as a folder prefix. Patterns are normalized (no leading/trailing
 * slash) before comparison so "Templates", "Templates/", and "/Templates" all behave the same.
 *
 * Note: Obsidian does have its own core "excluded files" list, but it's exposed only through an
 * untyped/undocumented `vault.getConfig(...)` call with no entry in obsidian.d.ts -- relying on
 * it risks breaking silently on an Obsidian update. This plugin keeps its own explicit list
 * instead (see plans/v2-scale-first.md §4 Phase 3); a future version could still additionally
 * read Obsidian's list on a best-effort basis if that's worth the risk.
 */

function normalize(pattern: string): string {
	return pattern.trim().replace(/^\/+/, "").replace(/\/+$/, "");
}

export function matchesExcludePattern(path: string, patterns: string[]): boolean {
	for (const raw of patterns) {
		const pattern = normalize(raw);
		if (!pattern) continue;
		if (path === pattern || path.startsWith(pattern + "/")) return true;
	}
	return false;
}
