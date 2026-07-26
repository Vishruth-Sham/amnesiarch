export interface NoteEntry {
	path: string;
	title: string;
	mtime: number;
	ctime: number;
	folderChain: string[];
	tags: string[];
	aliases: string[];
	outgoingLinks: string[];
	backlinks: string[];
	embedding: number[];
}

export interface EmbeddingCacheFile {
	version: 1;
	model: string;
	dim: number;
	entries: Record<string, NoteEntry>;
}

export interface SearchResult {
	entry: NoteEntry;
	score: number;
}
