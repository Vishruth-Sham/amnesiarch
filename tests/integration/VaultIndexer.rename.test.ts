import { afterEach, describe, expect, it, vi } from "vitest";
import { VaultIndexer } from "../../src/index/VaultIndexer";
import { NoteCache } from "../../src/index/NoteCache";
import { createFixtureApp } from "../support/testApp";
import { INDEX_DEBOUNCE_MS } from "../../src/constants";

describe("VaultIndexer.rename", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("moves the cache entry to the new path and drops the old one", async () => {
		const { app, fixture, mockApp } = createFixtureApp();
		const cache = new NoteCache(app, ".obsidian/plugins/amnesiarch");
		const indexer = new VaultIndexer(app, cache);
		await indexer.initialize();

		const oldPath = fixture.meta.clusters[2].notePaths[0];
		const newPath = fixture.meta.clusters[2].notePaths[0].replace(".md", " Renamed.md");

		vi.useFakeTimers();
		await mockApp.vault.renameFile(oldPath, newPath);
		indexer.rename(oldPath, newPath);
		await vi.advanceTimersByTimeAsync(INDEX_DEBOUNCE_MS + 50);

		expect(cache.get(oldPath)).toBeUndefined();
		expect(cache.get(newPath)).toBeDefined();
	});

	it("re-queues every note whose outgoingLinks referenced the old path", async () => {
		const { app, fixture, mockApp } = createFixtureApp();
		const cache = new NoteCache(app, ".obsidian/plugins/amnesiarch");
		const indexer = new VaultIndexer(app, cache);
		await indexer.initialize();

		const { from: linkingNotePath, to: oldPath } = fixture.meta.chainLinks[0];
		const newPath = oldPath.replace(".md", " Renamed.md");
		const oldTitle = oldPath.split("/").pop()!.replace(/\.md$/, "");
		const newTitle = newPath.split("/").pop()!.replace(/\.md$/, "");

		// Precondition: the linking note's cached outgoingLinks does reference the old path before
		// the rename (sanity-checking the fixture assumption this test depends on).
		expect(cache.get(linkingNotePath)!.outgoingLinks).toContain(oldPath);

		vi.useFakeTimers();
		await mockApp.vault.renameFile(oldPath, newPath);
		// Real Obsidian rewrites other notes' wikilink text as part of a rename (a separate feature
		// from what VaultIndexer.rename() itself does); simulate that here so the link text still
		// resolves, isolating this test to VaultIndexer's own re-queue responsibility.
		const linkingContent = mockApp.vault.peekContent(linkingNotePath)!;
		await mockApp.vault.modifyFile(linkingNotePath, linkingContent.replace(`[[${oldTitle}]]`, `[[${newTitle}]]`));
		indexer.rename(oldPath, newPath);
		await vi.advanceTimersByTimeAsync(INDEX_DEBOUNCE_MS + 50);

		// The linking note was re-indexed (re-queued by rename()) and its outgoingLinks now point
		// at the new path, since MetadataCache re-resolves the wikilink against the renamed file.
		expect(cache.get(linkingNotePath)!.outgoingLinks).toContain(newPath);
		expect(cache.get(linkingNotePath)!.outgoingLinks).not.toContain(oldPath);
	});
});
