import { describe, expect, it } from "vitest";
import type { TFile } from "obsidian";
import { extractMetadata } from "../../src/index/MetadataExtractor";
import { createFixtureApp } from "../support/testApp";

describe("MetadataExtractor.extractMetadata (against the dense fixture vault)", () => {
	const { app, fixture } = createFixtureApp();

	function file(path: string): TFile {
		const f = app.vault.getAbstractFileByPath(path);
		if (!f) throw new Error(`expected a file at ${path}`);
		return f as TFile;
	}

	it("extracts an exact chain-link outgoing/backlink pair", () => {
		const { from, to } = fixture.meta.chainLinks[0];
		const fromMeta = extractMetadata(app, file(from));
		const toMeta = extractMetadata(app, file(to));
		expect(fromMeta.outgoingLinks).toContain(to);
		expect(toMeta.backlinks).toContain(from);
	});

	it("resolves an alias-form link ([[Title|alias]]) to the target path", () => {
		const { from, to } = fixture.meta.aliasLink;
		const meta = extractMetadata(app, file(from));
		expect(meta.outgoingLinks).toContain(to);
	});

	it("resolves an explicit vault-relative-path link", () => {
		const { from, to } = fixture.meta.explicitPathLink;
		const meta = extractMetadata(app, file(from));
		expect(meta.outgoingLinks).toContain(to);
	});

	it("excludes an intentionally-broken link from outgoingLinks", () => {
		const { from } = fixture.meta.brokenLink;
		const meta = extractMetadata(app, file(from));
		// Every resolved target must be a real vault path; nothing should have resolved to a
		// "Nonexistent..." note since none exists.
		for (const link of meta.outgoingLinks) {
			expect(link.toLowerCase()).not.toContain("nonexistent");
		}
	});

	it("resolves a duplicate-basename link to the same-folder candidate first", () => {
		const { from, expectedTarget } = fixture.meta.duplicateBasenameSameFolderLink;
		const meta = extractMetadata(app, file(from));
		expect(meta.outgoingLinks).toContain(expectedTarget);
	});

	it("resolves a duplicate-basename link to the shortest-path candidate when no folder tie-break applies", () => {
		const { from, expectedTarget } = fixture.meta.duplicateBasenameTieBreakLink;
		const meta = extractMetadata(app, file(from));
		expect(meta.outgoingLinks).toContain(expectedTarget);
	});

	it("builds the correct folderChain for a deeply-nested note", () => {
		const meta = extractMetadata(app, file(fixture.meta.deepNotePath));
		expect(meta.folderChain).toEqual(fixture.meta.deepNoteFolderChain);
	});

	it("returns an empty frontmatter bag (not a throw) for a note with no frontmatter", () => {
		const meta = extractMetadata(app, file(fixture.meta.noFrontmatterNotePath));
		expect(meta.frontmatter).toEqual({});
		expect(meta.tags).toEqual([]);
		expect(meta.aliases).toEqual([]);
	});

	it("flattens an array-valued frontmatter key and skips an object-valued one", () => {
		const meta = extractMetadata(app, file(fixture.meta.mixedFrontmatterNotePath));
		expect(meta.frontmatter.collaborators).toBe("Alex, Sam");
		expect(meta.frontmatter.details).toBeUndefined();
	});

	it("excludes tags/aliases/position from the generic frontmatter bag", () => {
		const meta = extractMetadata(app, file(fixture.meta.mixedFrontmatterNotePath));
		expect(meta.frontmatter.tags).toBeUndefined();
		expect(meta.frontmatter.position).toBeUndefined();
	});

	it("picks up a cluster tag via getAllTags", () => {
		const cluster = fixture.meta.clusters[0];
		const meta = extractMetadata(app, file(cluster.notePaths[0]));
		expect(meta.tags).toContain(cluster.tag);
	});

	it("title falls back to the file basename", () => {
		const meta = extractMetadata(app, file(fixture.meta.deepNotePath));
		expect(meta.title).toBe("Deep Note");
	});
});
