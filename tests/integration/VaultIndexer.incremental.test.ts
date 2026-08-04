import { afterEach, describe, expect, it, vi } from "vitest";
import { VaultIndexer } from "../../src/index/VaultIndexer";
import { NoteCache } from "../../src/index/NoteCache";
import { createFixtureApp } from "../support/testApp";
import { INDEX_DEBOUNCE_MS } from "../../src/constants";

describe("VaultIndexer incremental queue/debounce", () => {
	// Fake timers are only switched on after the initial (real-timer) index pass below --
	// VaultIndexer.indexFile() yields to the event loop via window.setTimeout(resolve, 0), which
	// would hang forever under fake timers unless something is actively advancing them.
	afterEach(() => {
		vi.useRealTimers();
	});

	it("does not re-embed on queue() alone -- only after the debounce elapses", async () => {
		const { app, fixture, mockApp } = createFixtureApp();
		const cache = new NoteCache(app, ".obsidian/plugins/amnesiarch");
		const indexer = new VaultIndexer(app, cache);
		await indexer.initialize();

		const path = fixture.meta.clusters[0].notePaths[0];
		const before = cache.get(path)!.chunks[0].vector;

		vi.useFakeTimers();
		await mockApp.vault.modifyFile(path, "# Changed\n\nSomething completely different now.");
		indexer.queue(path);
		expect(cache.get(path)!.chunks[0].vector).toBe(before); // not re-embedded yet

		await vi.advanceTimersByTimeAsync(INDEX_DEBOUNCE_MS + 50);
		expect(cache.get(path)!.chunks[0].vector).not.toBe(before);
	});

	it("coalesces bursts of queue() calls into a single debounced processing pass", async () => {
		const { app, fixture, mockApp } = createFixtureApp();
		const cache = new NoteCache(app, ".obsidian/plugins/amnesiarch");
		const indexer = new VaultIndexer(app, cache);
		await indexer.initialize();

		const path = fixture.meta.clusters[0].notePaths[1];
		let progressCalls = 0;
		indexer.onIndexingStart = () => progressCalls++;

		vi.useFakeTimers();
		for (let i = 0; i < 5; i++) {
			await mockApp.vault.modifyFile(path, `# Changed ${i}\n\nBody ${i}.`);
			indexer.queue(path);
			await vi.advanceTimersByTimeAsync(INDEX_DEBOUNCE_MS / 2); // never let the debounce fully elapse
		}
		await vi.advanceTimersByTimeAsync(INDEX_DEBOUNCE_MS + 50);

		expect(progressCalls).toBe(1); // one processing pass, not five
	});

	it("processes the most-recently-modified queued file first", async () => {
		const { app, fixture, mockApp } = createFixtureApp();
		const cache = new NoteCache(app, ".obsidian/plugins/amnesiarch");
		const indexer = new VaultIndexer(app, cache);
		await indexer.initialize();

		const [pathA, pathB] = fixture.meta.clusters[1].notePaths;
		const order: string[] = [];
		const originalSet = cache.set.bind(cache);
		cache.set = (path, entry) => {
			order.push(path);
			return originalSet(path, entry);
		};

		vi.useFakeTimers();
		// Modify B first (older mtime), then A (newer mtime) -- A should process first.
		await mockApp.vault.modifyFile(pathB, "# B changed\n\nnew body\n", Date.now() - 1000);
		await mockApp.vault.modifyFile(pathA, "# A changed\n\nnew body\n", Date.now());
		indexer.queue(pathB);
		indexer.queue(pathA);
		await vi.advanceTimersByTimeAsync(INDEX_DEBOUNCE_MS + 50);

		expect(order[0]).toBe(pathA);
		expect(order[1]).toBe(pathB);
	});
});
