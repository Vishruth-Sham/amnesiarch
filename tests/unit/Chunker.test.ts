import { describe, expect, it } from "vitest";
import { chunkContent } from "../../src/index/Chunker";
import { HeadingCache } from "../support/obsidianMock";

function heading(heading: string, level: number, line: number): HeadingCache {
	return { heading, level, position: { start: { line, col: 0, offset: 0 }, end: { line, col: 0, offset: 0 } } };
}

describe("Chunker.chunkContent", () => {
	it("returns a single no-heading chunk for content with no headings", () => {
		const chunks = chunkContent("Just a short note with no headings at all.", undefined);
		expect(chunks).toHaveLength(1);
		expect(chunks[0].headingPath).toBe("");
	});

	it("returns zero chunks for empty/whitespace-only content", () => {
		expect(chunkContent("", undefined)).toHaveLength(0);
		expect(chunkContent("   \n\n  ", undefined)).toHaveLength(0);
	});

	it("builds nested heading paths from the heading stack", () => {
		const content = ["# Project ABC", "intro text", "## Meeting notes", "meeting body text here"].join("\n");
		const headings = [heading("Project ABC", 1, 0), heading("Meeting notes", 2, 2)];
		const chunks = chunkContent(content, headings);
		const paths = chunks.map((c) => c.headingPath);
		expect(paths).toContain("Project ABC");
		expect(paths).toContain("Project ABC > Meeting notes");
	});

	it("pops the heading stack when a later heading is shallower or equal level", () => {
		const content = ["# A", "## B", "text under B", "# C", "text under C"].join("\n");
		const headings = [heading("A", 1, 0), heading("B", 2, 1), heading("C", 1, 3)];
		const chunks = chunkContent(content, headings);
		const paths = chunks.map((c) => c.headingPath);
		expect(paths).toContain("A > B");
		expect(paths).toContain("C");
		expect(paths).not.toContain("A > C");
	});

	it("splits an oversized paragraph with overlap rather than leaving it whole", () => {
		const longParagraph = "word ".repeat(400); // ~2000 chars, well over CHUNK_CHAR_BUDGET (800)
		const chunks = chunkContent(longParagraph, undefined);
		expect(chunks.length).toBeGreaterThan(1);
		for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(800);
	});

	it("packs multiple short paragraphs together under the char budget", () => {
		const content = Array.from({ length: 5 }, (_, i) => `Paragraph number ${i} with some words in it.`).join("\n\n");
		const chunks = chunkContent(content, undefined);
		expect(chunks).toHaveLength(1);
		expect(chunks[0].text).toContain("Paragraph number 0");
		expect(chunks[0].text).toContain("Paragraph number 4");
	});

	it("caps chunks per note via even-stride downsampling, keeping deterministic coverage", () => {
		const paragraph = "x".repeat(700);
		const content = Array.from({ length: 60 }, () => paragraph).join("\n\n");
		const chunks = chunkContent(content, undefined);
		expect(chunks.length).toBeLessThanOrEqual(20); // MAX_CHUNKS_PER_NOTE

		const again = chunkContent(content, undefined);
		expect(again).toEqual(chunks); // deterministic across repeated calls
	});
});
