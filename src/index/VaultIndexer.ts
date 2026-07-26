import { App, TFile } from "obsidian";
import { embedText } from "../embeddings/EmbeddingModel";
import { extractMetadata } from "./MetadataExtractor";
import { NoteCache } from "./NoteCache";
import { INDEX_DEBOUNCE_MS } from "../constants";

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
			const cached = this.cache.get(file.path);
			if (!cached || cached.mtime !== file.stat.mtime) {
				this.dirty.add(file.path);
			}
		}

		if (this.dirty.size > 0) {
			await this.processQueue();
		} else {
			await this.cache.save();
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
		void this.cache.save();
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

	private async processQueue(): Promise<void> {
		if (this.processing) return;
		if (this.dirty.size === 0) return;
		this.processing = true;

		const paths = Array.from(this.dirty);
		this.dirty.clear();
		const total = paths.length;
		this.onIndexingStart?.(total);

		let done = 0;
		for (const path of paths) {
			const file = this.app.vault.getAbstractFileByPath(path);
			if (file instanceof TFile && file.extension === "md") {
				try {
					const content = await this.app.vault.cachedRead(file);
					const embedding = await embedText(content.slice(0, 4000) || file.basename);
					const metadata = extractMetadata(this.app, file);
					this.cache.set(path, { path, embedding, ...metadata });
				} catch (e) {
					console.error(`AI Notes: failed to index ${path}`, e);
				}
			}
			done++;
			this.onProgress?.(done, total);
			if (done % 5 === 0) {
				await new Promise((resolve) => setTimeout(resolve, 0));
			}
		}

		await this.cache.save();
		this.processing = false;
		this.onIndexingComplete?.();

		// More work may have queued while we were processing.
		if (this.dirty.size > 0) {
			void this.processQueue();
		}
	}
}
