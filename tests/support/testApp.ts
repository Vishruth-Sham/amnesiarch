import type { App as RealApp } from "obsidian";
import { App as MockApp } from "./obsidianMock";
import { buildFixtureVault, FixtureVault } from "./fixtureVault";

/**
 * Returned as the real (type-only) obsidian `App` type -- so it can be passed directly into
 * NoteCache/VaultIndexer/etc. without a cast at every call site -- while actually being our mock
 * instance underneath. This works because vitest.config.ts aliases "obsidian" to obsidianMock.ts
 * at runtime; `tsc --noEmit`, which doesn't see that alias, only needs the *type* to line up,
 * and a type-only import + cast here is exactly the seam where that's reconciled once.
 */
function asRealApp(app: MockApp): RealApp {
	return app as unknown as RealApp;
}

/** A fresh mock App with the dense fixture vault loaded and metadata parsed, ready to drive
 *  VaultIndexer/MetadataExtractor/HybridSearch integration tests. */
export function createFixtureApp(seed = 42): { app: RealApp; mockApp: MockApp; fixture: FixtureVault } {
	const mockApp = new MockApp();
	const fixture = buildFixtureVault(seed);
	mockApp.vault.seedFiles(fixture.files);
	mockApp.metadataCache.recomputeAll();
	return { app: asRealApp(mockApp), mockApp, fixture };
}

/** A fresh, empty mock App -- for tests (NoteCache persistence, CreateNoteService, AppendService)
 *  that construct their own small, hand-specified vault state rather than using the dense fixture. */
export function createEmptyApp(): { app: RealApp; mockApp: MockApp } {
	const mockApp = new MockApp();
	return { app: asRealApp(mockApp), mockApp };
}
