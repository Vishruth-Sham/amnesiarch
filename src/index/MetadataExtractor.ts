import { App, TFile, getAllTags } from "obsidian";

export interface NoteMetadata {
	title: string;
	folderChain: string[];
	tags: string[];
	aliases: string[];
	outgoingLinks: string[];
	backlinks: string[];
	frontmatter: Record<string, string>;
	ctime: number;
	mtime: number;
}

/** Frontmatter keys already captured elsewhere on NoteEntry (or injected by Obsidian itself),
 *  so they're excluded from the generic `frontmatter` bag to avoid duplicate/confusing entries. */
const FRONTMATTER_KEYS_EXCLUDED = new Set(["tags", "aliases", "position"]);

/** Flatten a frontmatter value to a single string for the generic `frontmatter` bag (used by
 *  vault profiling and, later, structured query grounding). Arrays -> comma-joined; objects are
 *  skipped (nested YAML structures aren't meaningful as a flat key->value signal); everything
 *  else -> String(). */
function flattenFrontmatterValue(value: unknown): string | null {
	if (value === null || value === undefined) return null;
	if (Array.isArray(value)) return value.map((v) => String(v)).join(", ");
	if (typeof value === "object") return null;
	return String(value);
}

function extractFrontmatter(frontmatter: Record<string, unknown> | undefined): Record<string, string> {
	if (!frontmatter) return {};
	const out: Record<string, string> = {};
	for (const [key, value] of Object.entries(frontmatter)) {
		if (FRONTMATTER_KEYS_EXCLUDED.has(key)) continue;
		const flat = flattenFrontmatterValue(value);
		if (flat !== null && flat !== "") out[key] = flat;
	}
	return out;
}

export function extractMetadata(app: App, file: TFile): NoteMetadata {
	const cache = app.metadataCache.getFileCache(file);
	const folderChain = file.parent && file.parent.path !== "/" ? file.parent.path.split("/").filter(Boolean) : [];
	const tags = cache ? getAllTags(cache) ?? [] : [];
	// FrontMatterCache is typed `{ [key: string]: any }` by Obsidian -- narrow to `unknown` at the
	// assignment boundary rather than letting `any` propagate into `rawAliases`'s type.
	const rawAliases: unknown = cache?.frontmatter?.aliases;
	const aliases = Array.isArray(rawAliases) ? rawAliases.map(String) : rawAliases ? [String(rawAliases)] : [];
	const outgoingLinks = Object.keys(app.metadataCache.resolvedLinks[file.path] ?? {});
	const backlinks = Object.entries(app.metadataCache.resolvedLinks)
		.filter(([sourcePath, targets]) => sourcePath !== file.path && file.path in targets)
		.map(([sourcePath]) => sourcePath);

	return {
		title: file.basename,
		folderChain,
		tags: tags.map((t) => t.replace(/^#/, "")),
		aliases,
		outgoingLinks,
		backlinks,
		frontmatter: extractFrontmatter(cache?.frontmatter),
		ctime: file.stat.ctime,
		mtime: file.stat.mtime,
	};
}
