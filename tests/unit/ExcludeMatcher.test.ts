import { describe, expect, it } from "vitest";
import { matchesExcludePattern } from "../../src/index/ExcludeMatcher";

describe("ExcludeMatcher.matchesExcludePattern", () => {
	it("matches an exact path", () => {
		expect(matchesExcludePattern("Templates/Daily.md", ["Templates/Daily.md"])).toBe(true);
	});

	it("matches a folder prefix", () => {
		expect(matchesExcludePattern("Templates/Daily.md", ["Templates"])).toBe(true);
		expect(matchesExcludePattern("Templates/Sub/Daily.md", ["Templates"])).toBe(true);
	});

	it("does not match a folder whose name merely shares a prefix", () => {
		expect(matchesExcludePattern("TemplatesArchive/Daily.md", ["Templates"])).toBe(false);
	});

	it("normalizes leading/trailing slashes so they behave the same", () => {
		const path = "Templates/Daily.md";
		expect(matchesExcludePattern(path, ["Templates/"])).toBe(true);
		expect(matchesExcludePattern(path, ["/Templates"])).toBe(true);
		expect(matchesExcludePattern(path, ["/Templates/"])).toBe(true);
	});

	it("ignores blank patterns", () => {
		expect(matchesExcludePattern("Templates/Daily.md", ["", "   "])).toBe(false);
	});

	it("returns false when nothing matches", () => {
		expect(matchesExcludePattern("Projects/Note.md", ["Templates", "Archive"])).toBe(false);
	});
});
