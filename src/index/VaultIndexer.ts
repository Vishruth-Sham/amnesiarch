import { App, TFile } from "obsidian";
import { embedText } from "../embeddings/EmbeddingModel";
import { quantizeVector } from "../embeddings/Quantize";
import { INDEX_DEBOUNCE_MS, SAVE_CHECKPOINT_INTERVAL } from "../constants";
import { NoteChunk } from "../types";
import { chunkContent } from "./Chunker";
import { matchesExcludePattern } from "./ExcludeMatcher";
import { extractMetadata } from "./MetadataExtractor";
import { NoteCache } from "./NoteCache";

function yieldToEventLoop(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

export class VaultIndexer {
	private dirty = new Set<string>();
	private debounceTimer: ReturnType<typeof setTimeout> | null = null;
	private processing = false;

	onProgress: ((done: number, total: number) => void) | null = null;
	onIndexingStart: ((total: number) => void) | null = null;
	onIndexingComplete: (() => void) | null = null;

	constructor(
		private app: App,
		private cache: NoteCache,
		/** Live getter (not a snapshot) so a settings change takes effect on the next index pass
		 *  without needing to reconstruct this indexer. */
		private getExcludePatterns: () => string[] = () => [],
	) {}

	isIndexing(): boolean {
		return this.processing;
	}

	/** Reconcile the cache against the current vault state, then process anything dirty. */
	async initialize(): Promise<void> {
		await this.cache.load();

		const files = this.app.vault.getMarkdownFiles();
		const existingPaths = new Set(files.map((f) => f.path));
		this.cache.prune(existingPaths);

		for (const file of files) {
			const excluded = matchesExcludePattern(file.path, this.getExcludePatterns());
			const cached = this.cache.get(file.path);
			if (excluded) {
				// Not indexed yet -> just skip. Already cached (pattern changed since last run) ->
				// mark dirty so processQueue's exclude check sweeps it out of the cache.
				if (cached) this.dirty.add(file.path);
				continue;
			}
			if (!cached || cached.mtime !== file.stat.mtime) {
				this.dirty.add(file.path);
			}
		}

		if (this.dirty.size > 0) {
			await this.processQueue();
		} else {
			await this.cache.flush();
		}
	}

	/** Queue a file for (re)embedding + metadata refresh; debounced so bursts coalesce. */
	queue(path: string): void {
		this.dirty.add(path);
		if (this.debounceTimer) clearTimeout(this.debounceTimer);
		this.debounceTimer = setTimeout(() => {
			this.debounceTimer = null;
			void this.processQueue();
		}, INDEX_DEBOUNCE_MS);
	}

	remove(path: string): void {
		this.dirty.delete(path);
		this.cache.delete(path);
		this.cache.scheduleSave();
	}

	rename(oldPath: string, newPath: string): void {
		const entry = this.cache.get(oldPath);
		if (entry) this.cache.delete(oldPath);
		// Re-embed under the new path: title/folder depend on path, so treat as dirty
		// rather than just moving the cache key.
		this.dirty.delete(oldPath);
		this.queue(newPath);

		// Any note that linked to the old path needs its outgoingLinks/backlinks refreshed.
		for (const other of this.cache.getAll()) {
			if (other.outgoingLinks.includes(oldPath) || other.path === newPath) {
				this.queue(other.path);
			}
		}
	}

	/** Force every markdown file to be reconsidered from scratch -- exposed as the
	 *  "AI Notes: Rebuild index" command. A manual escape hatch (e.g. to immediately sweep out
	 *  notes after tightening exclude patterns, rather than waiting for them to next change). */
	async rebuildAll(): Promise<void> {
		for (const file of this.app.vault.getMarkdownFiles()) {
			this.dirty.add(file.path);
		}
		await this.processQueue();
	}

	private async processQueue(): Promise<void> {
		if (this.processing) return;
		if (this.dirty.size === 0) return;
		this.processing = true;

		const paths = Array.from(this.dirty);
		this.dirty.clear();

		// Most-recently-modified first: on a large, never-before-indexed vault this makes the
		// plugin searchable over the notes a user is actually likely to be adding to within
		// seconds, rather than in arbitrary directory-listing order (plans/v2-scale-first.md
		// §4 Phase 3).
		const mtimeOf = (path: string): number => {
			const f = this.app.vault.getAbstractFileByPath(path);
			return f instanceof TFile ? f.stat.mtime : 0;
		};
		paths.sort((a, b) => mtimeOf(b) - mtimeOf(a));

		const total = paths.length;
		this.onIndexingStart?.(total);

		let done = 0;
		for (const path of paths) {
			const file = this.app.vault.getAbstractFileByPath(path);
			if (file instanceof TFile && file.extension === "md") {
				if (matchesExcludePattern(path, this.getExcludePatterns())) {
					this.cache.delete(path);
				} else {
					try {
						await this.indexFile(file);
					} catch (e) {
						console.error(`AI Notes: failed to index ${path}`, e);
					}
				}
			}
			done++;
			this.onProgress?.(done, total);
			if (done % 5 === 0) await yieldToEventLoop();
			// Checkpoint to disk periodically during a long run: NoteCache.flush() is an immediate,
			// undebounced write, so quitting mid-build loses at most SAVE_CHECKPOINT_INTERVAL notes
			// of progress rather than the entire batch (plans/v2-scale-first.md §4 Phase 3).
			if (done % SAVE_CHECKPOINT_INTERVAL === 0) await this.cache.flush();
		}

		await this.cache.flush();
		this.processing = false;
		this.onIndexingComplete?.();

		// More work may have queued while we were processing.
		if (this.dirty.size > 0) {
			void this.processQueue();
		}
	}

	private async indexFile(file: TFile): Promise<void> {
		const content = await this.app.vault.cachedRead(file);
		const headings = this.app.metadataCache.getFileCache(file)?.headings;
		const rawChunks = chunkContent(content, headings);
		// Fallback for an empty/whitespace-only note: embed the title so it's still findable by
		// name even though it has no body content to chunk.
		const sourceChunks = rawChunks.length > 0 ? rawChunks : [{ headingPath: "", text: file.basename }];

		const chunks: NoteChunk[] = [];
		for (let i = 0; i < sourceChunks.length; i++) {
			const raw = sourceChunks[i];
			const vec = await embedText(raw.text);
			chunks.push({ headingPath: raw.headingPath, vector: quantizeVector(vec) });
			if (i % 5 === 4) await yieldToEventLoop();
		}

		const metadata = extractMetadata(this.app, file);
		this.cache.set(file.path, { path: file.path, chunks, ...metadata });
	}
}
