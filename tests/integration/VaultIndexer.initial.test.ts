import { describe, expect, it } from "vitest";
import { VaultIndexer } from "../../src/index/VaultIndexer";
import { NoteCache } from "../../src/index/NoteCache";
import { createFixtureApp } from "../support/testApp";

describe("VaultIndexer.initialize (full dense fixture vault)", () => {
	it("indexes every markdown note in the vault", async () => {
		const { app, fixture } = createFixtureApp();
		const cache = new NoteCache(app, ".obsidian/plugins/amnesiarch");
		const indexer = new VaultIndexer(app, cache);
		await indexer.initialize();
		expect(cache.size()).toBe(fixture.meta.totalNoteCount);
	}, 30000);

	it("gives every indexed note at least one chunk, including the empty-note title fallback", async () => {
		const { app, fixture } = createFixtureApp();
		const cache = new NoteCache(app, ".obsidian/plugins/amnesiarch");
		const indexer = new VaultIndexer(app, cache);
		await indexer.initialize();

		const empty = cache.get(fixture.meta.emptyNotePath);
		expect(empty).toBeDefined();
		expect(empty!.chunks.length).toBeGreaterThanOrEqual(1);

		for (const entry of cache.getAll()) {
			expect(entry.chunks.length).toBeGreaterThanOrEqual(1);
		}
	}, 30000);

	it("downsamples an oversized note to at most MAX_CHUNKS_PER_NOTE chunks", async () => {
		const { app, fixture } = createFixtureApp();
		const cache = new NoteCache(app, ".obsidian/plugins/amnesiarch");
		const indexer = new VaultIndexer(app, cache);
		await indexer.initialize();
		const huge = cache.get(fixture.meta.hugeNotePath);
		expect(huge!.chunks.length).toBeLessThanOrEqual(20);
	}, 30000);

	it("excludes notes under an excluded folder pattern", async () => {
		const { app, fixture } = createFixtureApp();
		const cache = new NoteCache(app, ".obsidian/plugins/amnesiarch");
		const indexer = new VaultIndexer(app, cache, () => [fixture.meta.excludedFolder]);
		await indexer.initialize();

		for (const path of fixture.meta.excludedFolderNotePaths) {
			expect(cache.get(path)).toBeUndefined();
		}
		expect(cache.size()).toBe(fixture.meta.totalNoteCount - fixture.meta.excludedFolderNotePaths.length);
	}, 30000);

	it("sweeps an already-cached note out when it becomes excluded on the next initialize()", async () => {
		const { app, fixture } = createFixtureApp();
		const cache = new NoteCache(app, ".obsidian/plugins/amnesiarch");
		let excluded: string[] = [];
		const indexer = new VaultIndexer(app, cache, () => excluded);
		await indexer.initialize();
		expect(cache.get(fixture.meta.excludedFolderNotePaths[0])).toBeDefined();

		excluded = [fixture.meta.excludedFolder];
		const indexer2 = new VaultIndexer(app, cache, () => excluded);
		await indexer2.initialize();
		expect(cache.get(fixture.meta.excludedFolderNotePaths[0])).toBeUndefined();
	}, 30000);

	it("captures correct metadata for a note deep in a nested folder hierarchy", async () => {
		const { app, fixture } = createFixtureApp();
		const cache = new NoteCache(app, ".obsidian/plugins/amnesiarch");
		const indexer = new VaultIndexer(app, cache);
		await indexer.initialize();
		const entry = cache.get(fixture.meta.deepNotePath)!;
		expect(entry.folderChain).toEqual(fixture.meta.deepNoteFolderChain);
	}, 30000);
});
