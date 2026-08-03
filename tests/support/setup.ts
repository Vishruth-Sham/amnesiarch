import { vi } from "vitest";
import { fakeEmbedText } from "./fakeEmbedder";

// NoteCache/VaultIndexer call window.setTimeout/window.clearTimeout directly (deliberately, for
// popout-window compatibility in real Obsidian). Vitest's default "node" environment has no
// `window` global at all, so without this every debounce/save path throws a ReferenceError
// before any assertion runs.
if (typeof globalThis.window === "undefined") {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	(globalThis as any).window = globalThis;
}

// Global, not per-test-file: this makes it structurally impossible for an integration test to
// forget to mock the real embedder and accidentally trigger a live model download over the
// network during a test run.
vi.mock("../../src/embeddings/EmbeddingModel", () => ({
	embedText: (text: string) => fakeEmbedText(text),
}));
