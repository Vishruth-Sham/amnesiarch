import { describe, expect, it } from "vitest";
import { rankNoteMetadata } from "../../src/search/NotePicker";
import { NoteEntry } from "../../src/types";

function note(path: string, title: string): NoteEntry {
	return {
		path,
		title,
		mtime: 0,
		ctime: 0,
		folderChain: [],
		tags: [],
		aliases: [],
		outgoingLinks: [],
		backlinks: [],
		frontmatter: {},
		chunks: [],
	};
}

describe("NotePicker.rankNoteMetadata", () => {
	const entries = [
		note("Projects/Meeting Notes.md", "Meeting Notes"),
		note("Projects/Meeting Notes Archive.md", "Meeting Notes Archive"),
		note("Projects/Weekly Standup.md", "Weekly Standup"),
		note("Areas/Health/Mtg Notes.md", "Mtg Notes"),
	];

	it("returns [] for an empty or whitespace-only query", () => {
		expect(rankNoteMetadata("", entries)).toEqual([]);
		expect(rankNoteMetadata("   ", entries)).toEqual([]);
	});

	it("ranks an exact title match first", () => {
		const results = rankNoteMetadata("Meeting Notes", entries);
		expect(results[0].path).toBe("Projects/Meeting Notes.md");
	});

	it("ranks a title-prefix match above a substring-only match", () => {
		const results = rankNoteMetadata("Meeting", entries);
		const prefixIdx = results.findIndex((r) => r.path === "Projects/Meeting Notes.md");
		const archiveIdx = results.findIndex((r) => r.path === "Projects/Meeting Notes Archive.md");
		expect(prefixIdx).toBeLessThan(archiveIdx);
	});

	it("excludes entries where some query token matches nothing", () => {
		const results = rankNoteMetadata("Meeting Zzzznomatch", entries);
		expect(results.find((r) => r.path.includes("Meeting"))).toBeUndefined();
	});

	it("still surfaces a fuzzy/subsequence match for a typo'd query", () => {
		const results = rankNoteMetadata("Wekly Standup", entries); // dropped letter, order-preserving
		expect(results.some((r) => r.path === "Projects/Weekly Standup.md")).toBe(true);
	});

	it("never returns more than the given limit", () => {
		const many = Array.from({ length: 30 }, (_, i) => note(`n${i}.md`, `Report ${i}`));
		const results = rankNoteMetadata("Report", many, 5);
		expect(results).toHaveLength(5);
	});

	it("falls back to the path stem when title is missing/blank", () => {
		const malformed: NoteEntry = { ...note("Projects/Untitled Draft.md", ""), title: "" };
		const results = rankNoteMetadata("Untitled Draft", [malformed]);
		expect(results[0].title).toBe("Untitled Draft");
	});
});
