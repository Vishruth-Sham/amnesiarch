import { App } from "obsidian";
import { CACHE_FILE_NAME, CACHE_SAVE_DEBOUNCE_MS, CACHE_VERSION, EMBEDDING_DIM, MODEL_ID } from "../constants";
import { EmbeddingCacheFile, NoteEntry } from "../types";

export class NoteCache {
	private entries = new Map<string, NoteEntry>();
	private saveTimer: ReturnType<typeof setTimeout> | null = null;
	/** Bumped on every mutation; ProfileCache uses this to know when to recompute the vault
	 *  profile without re-deriving it on every keystroke. */
	generation = 0;

	constructor(
		private app: App,
		private pluginDir: string,
	) {}

	private get cachePath(): string {
		return `${this.pluginDir}/${CACHE_FILE_NAME}`;
	}

	async load(): Promise<void> {
		const adapter = this.app.vault.adapter;
		if (!(await adapter.exists(this.cachePath))) return;
		try {
			const raw = await adapter.read(this.cachePath);
			const parsed = JSON.parse(raw) as EmbeddingCacheFile;
			if (parsed.version !== CACHE_VERSION || parsed.model !== MODEL_ID || parsed.dim !== EMBEDDING_DIM) {
				// Cache format, model, or embedding dim changed since this was written -- start
				// clean rather than mixing schemas/embedding spaces. Re-indexing is correct here,
				// not a converter: chunk boundaries, quantization, and frontmatter capture all
				// changed in v2, so there's nothing meaningful to migrate note-by-note.
				this.entries.clear();
				return;
			}
			this.entries = new Map(Object.entries(parsed.entries));
		} catch (e) {
			console.error("AI Notes: failed to read notes cache, starting fresh", e);
			this.entries.clear();
		}
		this.generation++;
	}

	/** Write immediately, bypassing the debounce. Use for checkpoints during a long index run
	 *  and on plugin unload, where losing the pending debounce window would lose real progress. */
	async flush(): Promise<void> {
		if (this.saveTimer) {
			clearTimeout(this.saveTimer);
			this.saveTimer = null;
		}
		await this.save();
	}

	/** Debounced write. save() re-serializes the whole cache file, so calling it once per note
	 *  during a large index run would mean rewriting a potentially many-MB file per note; this
	 *  coalesces bursts of mutations into one write CACHE_SAVE_DEBOUNCE_MS after the last one. */
	scheduleSave(): void {
		if (this.saveTimer) return;
		this.saveTimer = setTimeout(() => {
			this.saveTimer = null;
			void this.save();
		}, CACHE_SAVE_DEBOUNCE_MS);
	}

	private async save(): Promise<void> {
		const file: EmbeddingCacheFile = {
			version: CACHE_VERSION,
			model: MODEL_ID,
			dim: EMBEDDING_DIM,
			entries: Object.fromEntries(this.entries),
		};
		await this.app.vault.adapter.write(this.cachePath, JSON.stringify(file));
	}

	get(path: string): NoteEntry | undefined {
		return this.entries.get(path);
	}

	set(path: string, entry: NoteEntry): void {
		this.entries.set(path, entry);
		this.generation++;
	}

	delete(path: string): void {
		this.entries.delete(path);
		this.generation++;
	}

	has(path: string): boolean {
		return this.entries.has(path);
	}

	prune(existingPaths: Set<string>): void {
		let pruned = false;
		for (const path of Array.from(this.entries.keys())) {
			if (!existingPaths.has(path)) {
				this.entries.delete(path);
				pruned = true;
			}
		}
		if (pruned) this.generation++;
	}

	getAll(): NoteEntry[] {
		return Array.from(this.entries.values());
	}

	size(): number {
		return this.entries.size;
	}
}
