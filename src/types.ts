/**
 * One chunk of a note's content, embedded independently (see src/index/Chunker.ts).
 * `vector` is a base64-encoded int8-quantized embedding (see src/embeddings/Quantize.ts) --
 * not a plain number[] -- to keep notes-cache.json a small fraction of its v1 size at
 * vault sizes in the thousands of notes. `headingPath` is kept (not the chunk's raw text)
 * so a future "jump to section" or section-targeted append can use it; search itself only
 * needs the vector.
 */
export interface NoteChunk {
	headingPath: string; // e.g. "Project ABC > Meeting notes", or "" for top-of-note/no headings
	vector: string; // base64 int8-quantized embedding
}

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
	/** Frontmatter keys/values present on this note, flattened to strings. Excludes `tags`/`aliases`
	 *  (already captured above) and Obsidian's own injected `position` key. */
	frontmatter: Record<string, string>;
	chunks: NoteChunk[];
}

export interface EmbeddingCacheFile {
	version: 2;
	model: string;
	dim: number;
	entries: Record<string, NoteEntry>;
}

export interface SearchResult {
	entry: NoteEntry;
	score: number;
}
