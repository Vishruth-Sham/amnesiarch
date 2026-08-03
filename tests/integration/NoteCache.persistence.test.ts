import { afterEach, describe, expect, it, vi } from "vitest";
import { NoteCache } from "../../src/index/NoteCache";
import { createEmptyApp } from "../support/testApp";
import { NoteEntry } from "../../src/types";
import { CACHE_VERSION, CACHE_SAVE_DEBOUNCE_MS, EMBEDDING_DIM, MODEL_ID } from "../../src/constants";

const PLUGIN_DIR = ".obsidian/plugins/amnesiarch";

function entry(path: string): NoteEntry {
	return {
		path,
		title: path.replace(".md", ""),
		mtime: 1,
		ctime: 1,
		folderChain: [],
		tags: [],
		aliases: [],
		outgoingLinks: [],
		backlinks: [],
		frontmatter: {},
		chunks: [],
	};
}

describe("NoteCache persistence", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("flush() writes immediately and load() reads it back", async () => {
		const { app } = createEmptyApp();
		const cache = new NoteCache(app, PLUGIN_DIR);
		cache.set("a.md", entry("a.md"));
		cache.set("b.md", entry("b.md"));
		await cache.flush();

		const reloaded = new NoteCache(app, PLUGIN_DIR);
		await reloaded.load();
		expect(reloaded.size()).toBe(2);
		expect(reloaded.get("a.md")).toBeDefined();
		expect(reloaded.get("b.md")).toBeDefined();
	});

	it("load() on a vault with no cache file yet leaves the cache empty (no throw)", async () => {
		const { app } = createEmptyApp();
		const cache = new NoteCache(app, PLUGIN_DIR);
		await expect(cache.load()).resolves.toBeUndefined();
		expect(cache.size()).toBe(0);
	});

	it("a version/model/dim mismatch triggers a full reset rather than a partial migration", async () => {
		const { app } = createEmptyApp();
		await app.vault.adapter.write(
			`${PLUGIN_DIR}/notes-cache.json`,
			JSON.stringify({
				version: CACHE_VERSION + 1, // stale format
				model: MODEL_ID,
				dim: EMBEDDING_DIM,
				entries: { "old.md": entry("old.md") },
			}),
		);
		const cache = new NoteCache(app, PLUGIN_DIR);
		await cache.load();
		expect(cache.size()).toBe(0);
		expect(cache.get("old.md")).toBeUndefined();
	});

	it("a malformed cache file is treated as empty rather than throwing", async () => {
		const { app } = createEmptyApp();
		await app.vault.adapter.write(`${PLUGIN_DIR}/notes-cache.json`, "{ not valid json");
		const cache = new NoteCache(app, PLUGIN_DIR);
		await expect(cache.load()).resolves.toBeUndefined();
		expect(cache.size()).toBe(0);
	});

	it("scheduleSave() coalesces bursts into a single debounced write", async () => {
		const { app, mockApp } = createEmptyApp();
		const cache = new NoteCache(app, PLUGIN_DIR);
		const writeSpy = vi.spyOn(mockApp.vault.adapter, "write");

		vi.useFakeTimers();
		cache.set("a.md", entry("a.md"));
		cache.scheduleSave();
		cache.set("b.md", entry("b.md"));
		cache.scheduleSave();
		cache.set("c.md", entry("c.md"));
		cache.scheduleSave();
		await vi.advanceTimersByTimeAsync(CACHE_SAVE_DEBOUNCE_MS + 50);

		expect(writeSpy).toHaveBeenCalledTimes(1);
	});

	it("flush() bypasses a pending debounce and writes immediately", async () => {
		const { app, mockApp } = createEmptyApp();
		const cache = new NoteCache(app, PLUGIN_DIR);
		const writeSpy = vi.spyOn(mockApp.vault.adapter, "write");

		vi.useFakeTimers();
		cache.set("a.md", entry("a.md"));
		cache.scheduleSave();
		await cache.flush(); // should write now, not after CACHE_SAVE_DEBOUNCE_MS
		expect(writeSpy).toHaveBeenCalledTimes(1);

		await vi.advanceTimersByTimeAsync(CACHE_SAVE_DEBOUNCE_MS + 50);
		expect(writeSpy).toHaveBeenCalledTimes(1); // the debounce timer was cancelled, not just pre-empted
	});

	it("prune() removes cache entries for paths no longer in the vault and bumps generation", async () => {
		const { app } = createEmptyApp();
		const cache = new NoteCache(app, PLUGIN_DIR);
		cache.set("a.md", entry("a.md"));
		cache.set("b.md", entry("b.md"));
		const genBefore = cache.generation;
		cache.prune(new Set(["a.md"]));
		expect(cache.get("a.md")).toBeDefined();
		expect(cache.get("b.md")).toBeUndefined();
		expect(cache.generation).toBeGreaterThan(genBefore);
	});

	it("delete()/has() behave as expected", () => {
		const { app } = createEmptyApp();
		const cache = new NoteCache(app, PLUGIN_DIR);
		cache.set("a.md", entry("a.md"));
		expect(cache.has("a.md")).toBe(true);
		cache.delete("a.md");
		expect(cache.has("a.md")).toBe(false);
	});
});
