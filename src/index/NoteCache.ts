import { App } from "obsidian";
import { CACHE_FILE_NAME, EMBEDDING_DIM, MODEL_ID } from "../constants";
import { EmbeddingCacheFile, NoteEntry } from "../types";

export class NoteCache {
	private entries = new Map<string, NoteEntry>();

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
			if (parsed.model !== MODEL_ID || parsed.dim !== EMBEDDING_DIM) {
				// Model changed since this cache was written; start clean rather than mixing embedding spaces.
				this.entries.clear();
				return;
			}
			this.entries = new Map(Object.entries(parsed.entries));
		} catch (e) {
			console.error("AI Notes: failed to read notes cache, starting fresh", e);
			this.entries.clear();
		}
	}

	async save(): Promise<void> {
		const file: EmbeddingCacheFile = {
			version: 1,
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
	}

	delete(path: string): void {
		this.entries.delete(path);
	}

	has(path: string): boolean {
		return this.entries.has(path);
	}

	prune(existingPaths: Set<string>): void {
		for (const path of Array.from(this.entries.keys())) {
			if (!existingPaths.has(path)) this.entries.delete(path);
		}
	}

	getAll(): NoteEntry[] {
		return Array.from(this.entries.values());
	}

	size(): number {
		return this.entries.size;
	}
}
