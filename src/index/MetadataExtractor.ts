import { App, TFile, getAllTags } from "obsidian";

export interface NoteMetadata {
	title: string;
	folderChain: string[];
	tags: string[];
	aliases: string[];
	outgoingLinks: string[];
	backlinks: string[];
	ctime: number;
	mtime: number;
}

export function extractMetadata(app: App, file: TFile): NoteMetadata {
	const cache = app.metadataCache.getFileCache(file);
	const folderChain = file.parent && file.parent.path !== "/" ? file.parent.path.split("/").filter(Boolean) : [];
	const tags = cache ? getAllTags(cache) ?? [] : [];
	const rawAliases = cache?.frontmatter?.aliases;
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
		ctime: file.stat.ctime,
		mtime: file.stat.mtime,
	};
}
