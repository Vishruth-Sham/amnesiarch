import { describe, expect, it } from "vitest";
import { computeVaultProfile } from "../../src/index/VaultProfiler";
import { NoteEntry } from "../../src/types";

function entry(overrides: Partial<NoteEntry> = {}): NoteEntry {
	return {
		path: overrides.path ?? "Note.md",
		title: overrides.title ?? "Note",
		mtime: 0,
		ctime: 0,
		folderChain: overrides.folderChain ?? [],
		tags: overrides.tags ?? [],
		aliases: overrides.aliases ?? [],
		outgoingLinks: overrides.outgoingLinks ?? [],
		backlinks: overrides.backlinks ?? [],
		frontmatter: overrides.frontmatter ?? {},
		chunks: overrides.chunks ?? [],
	};
}

describe("VaultProfiler.computeVaultProfile", () => {
	it("returns an all-zero profile for an empty vault", () => {
		const profile = computeVaultProfile([]);
		expect(profile.noteCount).toBe(0);
		expect(profile.tagCoverage).toBe(0);
		expect(profile.folderCoverage).toBe(0);
		expect(profile.linkDensity).toBe(0);
		expect(profile.titleInformativeness).toBe(0);
		expect(profile.schemaKeys).toEqual({});
	});

	it("computes tagCoverage and tagVocabRatio", () => {
		const entries = [
			entry({ path: "a.md", tags: ["x", "y"] }),
			entry({ path: "b.md", tags: ["x"] }),
			entry({ path: "c.md", tags: [] }),
		];
		const profile = computeVaultProfile(entries);
		expect(profile.tagCoverage).toBeCloseTo(2 / 3);
		expect(profile.tagVocabRatio).toBeCloseTo(2 / 2); // {x,y} unique / 2 tagged notes
	});

	it("computes folderCoverage from non-root notes", () => {
		const entries = [entry({ path: "a.md", folderChain: [] }), entry({ path: "b.md", folderChain: ["Projects"] })];
		const profile = computeVaultProfile(entries);
		expect(profile.folderCoverage).toBeCloseTo(0.5);
	});

	it("computes mean linkDensity", () => {
		const entries = [
			entry({ path: "a.md", outgoingLinks: ["b.md", "c.md"] }),
			entry({ path: "b.md", outgoingLinks: [] }),
		];
		const profile = computeVaultProfile(entries);
		expect(profile.linkDensity).toBeCloseTo(1);
	});

	it("scores titleInformativeness by alpha-token count (>=2 tokens of length >=3)", () => {
		const entries = [
			entry({ path: "a.md", title: "20240101" }), // zettelkasten-style, not informative
			entry({ path: "b.md", title: "Meeting Notes" }), // informative
		];
		const profile = computeVaultProfile(entries);
		expect(profile.titleInformativeness).toBeCloseTo(0.5);
	});

	it("only reports frontmatter keys present on at least 5% of notes", () => {
		const entries: NoteEntry[] = [];
		for (let i = 0; i < 20; i++) {
			entries.push(entry({ path: `n${i}.md`, frontmatter: i < 1 ? { rare: "x" } : i < 2 ? { common: "y" } : {} }));
		}
		// "common" is on 1/20 = 5% (>= threshold, included); "rare" is on 1/20 too (also >= 5%).
		// Add a genuinely-below-threshold key on nothing to keep this simple: assert the two keys
		// actually present both surface at their exact fraction.
		const profile = computeVaultProfile(entries);
		expect(profile.schemaKeys.common).toBeCloseTo(1 / 20);
		expect(profile.schemaKeys.rare).toBeCloseTo(1 / 20);
	});

	it("excludes a frontmatter key below the 5% threshold", () => {
		const entries: NoteEntry[] = [];
		for (let i = 0; i < 100; i++) {
			// Present on exactly 4 of 100 notes -> 4% < 5% threshold -> excluded.
			entries.push(entry({ path: `n${i}.md`, frontmatter: i < 4 ? { belowThreshold: "x" } : {} }));
		}
		const profile = computeVaultProfile(entries);
		expect(profile.schemaKeys.belowThreshold).toBeUndefined();
	});
});
