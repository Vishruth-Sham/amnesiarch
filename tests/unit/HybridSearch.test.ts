import { describe, expect, it } from "vitest";
import { search } from "../../src/search/HybridSearch";
import { quantizeVector } from "../../src/embeddings/Quantize";
import { NoteEntry, NoteChunk } from "../../src/types";
import { EQUAL_WEIGHTS } from "../../src/search/AdaptiveWeights";

function unitVec(dims: number, hotIndex: number): number[] {
	const v = new Array(dims).fill(0);
	v[hotIndex] = 1;
	return v;
}

function chunk(vec: number[], headingPath = ""): NoteChunk {
	return { headingPath, vector: quantizeVector(vec) };
}

function note(overrides: Partial<NoteEntry> & { path: string }): NoteEntry {
	return {
		title: "Note",
		mtime: 0,
		ctime: 0,
		folderChain: [],
		tags: [],
		aliases: [],
		outgoingLinks: [],
		backlinks: [],
		frontmatter: {},
		chunks: [],
		...overrides,
	};
}

describe("HybridSearch.search", () => {
	it("ranks the semantically closer note above an unrelated one", () => {
		const query = unitVec(4, 0);
		const entries = [
			note({ path: "close.md", title: "Close", chunks: [chunk(unitVec(4, 0))] }),
			note({ path: "far.md", title: "Far", chunks: [chunk(unitVec(4, 3))] }),
		];
		const results = search(query, "irrelevant query text", entries, EQUAL_WEIGHTS);
		expect(results[0].entry.path).toBe("close.md");
		expect(results[0].score).toBeGreaterThan(results[1].score);
	});

	it("uses the best-matching chunk (max), not the average across chunks", () => {
		const query = unitVec(4, 0);
		const entries = [
			note({
				path: "mixed.md",
				chunks: [chunk(unitVec(4, 0)), chunk(unitVec(4, 1)), chunk(unitVec(4, 2)), chunk(unitVec(4, 3))],
			}),
			note({ path: "mediocre.md", chunks: [chunk([0.5, 0.5, 0.5, 0.5])] }),
		];
		const results = search(query, "query", entries, EQUAL_WEIGHTS);
		// mixed.md's best chunk is a perfect match (dot=1), which should outrank a chunk with a
		// mediocre but consistent 0.5 dot product, even though mixed.md's other three chunks score 0.
		expect(results[0].entry.path).toBe("mixed.md");
	});

	it("blends in structural (title/folder/tag) score alongside semantic similarity", () => {
		const query = new Array(4).fill(0); // zero semantic contribution from either note
		const entries = [
			note({ path: "a/Project Alpha.md", title: "Project Alpha", folderChain: ["a"], chunks: [chunk(unitVec(4, 0))] }),
			note({ path: "b/Unrelated.md", title: "Unrelated", folderChain: ["b"], chunks: [chunk(unitVec(4, 0))] }),
		];
		const results = search(query, "project alpha", entries, EQUAL_WEIGHTS);
		expect(results[0].entry.path).toBe("a/Project Alpha.md");
		expect(results[0].score).toBeGreaterThan(results[1].score);
	});

	it("matches a tag only when the query text contains it verbatim", () => {
		const query = new Array(4).fill(0);
		const entries = [
			note({ path: "tagged.md", title: "X", tags: ["urgent"], chunks: [chunk(unitVec(4, 0))] }),
			note({ path: "untagged.md", title: "X", tags: [], chunks: [chunk(unitVec(4, 0))] }),
		];
		const results = search(query, "urgent task", entries, EQUAL_WEIGHTS);
		const tagged = results.find((r) => r.entry.path === "tagged.md")!;
		const untagged = results.find((r) => r.entry.path === "untagged.md")!;
		expect(tagged.score).toBeGreaterThan(untagged.score);
	});

	it("slices to topK results, sorted by descending score", () => {
		const query = unitVec(4, 0);
		const entries = Array.from({ length: 10 }, (_, i) => note({ path: `n${i}.md`, chunks: [chunk(unitVec(4, i % 4))] }));
		const results = search(query, "query", entries, EQUAL_WEIGHTS, 3);
		expect(results).toHaveLength(3);
		for (let i = 1; i < results.length; i++) {
			expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
		}
	});
});
