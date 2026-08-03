import { describe, expect, it } from "vitest";
import { VaultIndexer } from "../../src/index/VaultIndexer";
import { NoteCache } from "../../src/index/NoteCache";
import { createFixtureApp } from "../support/testApp";

describe("VaultIndexer.remove / prune", () => {
	it("remove() deletes the cache entry immediately (no debounce)", async () => {
		const { app, fixture } = createFixtureApp();
		const cache = new NoteCache(app, ".obsidian/plugins/amnesiarch");
		const indexer = new VaultIndexer(app, cache);
		await indexer.initialize();

		const path = fixture.meta.clusters[0].notePaths[0];
		expect(cache.get(path)).toBeDefined();
		indexer.remove(path);
		expect(cache.get(path)).toBeUndefined();
	});

	it("initialize()'s prune() sweeps out a cache entry for a file no longer in the vault", async () => {
		const { app, mockApp, fixture } = createFixtureApp();
		const cache = new NoteCache(app, ".obsidian/plugins/amnesiarch");
		const indexer = new VaultIndexer(app, cache);
		await indexer.initialize();

		const path = fixture.meta.clusters[0].notePaths[0];
		expect(cache.get(path)).toBeDefined();

		await mockApp.vault.deleteFile(path);
		const indexer2 = new VaultIndexer(app, cache);
		await indexer2.initialize();

		expect(cache.get(path)).toBeUndefined();
		expect(cache.size()).toBe(fixture.meta.totalNoteCount - 1);
	}, 30000);
});
