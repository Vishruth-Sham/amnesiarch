import { describe, expect, it, vi } from "vitest";
import { VaultIndexer } from "../../src/index/VaultIndexer";
import { NoteCache } from "../../src/index/NoteCache";
import { createFixtureApp } from "../support/testApp";

describe("VaultIndexer.rebuildAll", () => {
	it("re-indexes every note regardless of cached mtime state", async () => {
		const { app, fixture } = createFixtureApp();
		const cache = new NoteCache(app, ".obsidian/plugins/amnesiarch");
		const indexer = new VaultIndexer(app, cache);
		await indexer.initialize();
		expect(cache.size()).toBe(fixture.meta.totalNoteCount);

		const indexFileSpy = vi.spyOn(indexer as unknown as { indexFile: (f: unknown) => Promise<void> }, "indexFile");
		await indexer.rebuildAll();

		// Every markdown file was re-indexed, not just ones whose mtime changed since last time.
		expect(indexFileSpy).toHaveBeenCalledTimes(fixture.meta.totalNoteCount);
		expect(cache.size()).toBe(fixture.meta.totalNoteCount);
	}, 30000);

	it("is exposed as a full re-index even when nothing in the vault actually changed", async () => {
		const { app } = createFixtureApp();
		const cache = new NoteCache(app, ".obsidian/plugins/amnesiarch");
		const indexer = new VaultIndexer(app, cache);
		await indexer.initialize();

		// A second initialize() with nothing changed should do ~no work (dirty set empty); confirm
		// that's actually true before rebuildAll() below proves it forces work regardless.
		let progressCalls = 0;
		indexer.onIndexingStart = () => progressCalls++;
		const indexer2 = new VaultIndexer(app, cache);
		indexer2.onIndexingStart = () => progressCalls++;
		await indexer2.initialize();
		expect(progressCalls).toBe(0);

		await indexer.rebuildAll();
		expect(progressCalls).toBe(1);
	}, 30000);
});
