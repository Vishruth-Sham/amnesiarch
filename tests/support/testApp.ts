import { App } from "./obsidianMock";
import { buildFixtureVault, FixtureVault } from "./fixtureVault";

/** A fresh mock App with the dense fixture vault loaded and metadata parsed, ready to drive
 *  VaultIndexer/MetadataExtractor/HybridSearch integration tests. */
export function createFixtureApp(seed = 42): { app: App; fixture: FixtureVault } {
	const app = new App();
	const fixture = buildFixtureVault(seed);
	app.vault.seedFiles(fixture.files);
	app.metadataCache.recomputeAll();
	return { app, fixture };
}

/** A fresh, empty mock App -- for tests (NoteCache persistence, CreateNoteService, AppendService)
 *  that construct their own small, hand-specified vault state rather than using the dense fixture. */
export function createEmptyApp(): App {
	return new App();
}
