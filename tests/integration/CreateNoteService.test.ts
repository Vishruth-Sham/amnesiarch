import { describe, expect, it } from "vitest";
import { createNote, createNoteAtDestination, DestinationCreateError } from "../../src/create/CreateNoteService";
import { createEmptyApp, createFixtureApp } from "../support/testApp";

describe("CreateNoteService.createNote", () => {
	it("creates a note at the vault root", async () => {
		const { app } = createEmptyApp();
		const file = await createNote(app, "My New Note", "hello world");
		expect(file.path).toBe("My New Note.md");
	});

	it("resolves a filename collision with a numeric suffix, like Obsidian's own 'New note'", async () => {
		const { app } = createEmptyApp();
		await createNote(app, "Idea", "first");
		const second = await createNote(app, "Idea", "second");
		const third = await createNote(app, "Idea", "third");
		expect(second.path).toBe("Idea 1.md");
		expect(third.path).toBe("Idea 2.md");
	});

	it("preserves the exact content verbatim (append-text invariant), only adding a trailing newline", async () => {
		const { app, mockApp } = createEmptyApp();
		const content = "  leading and trailing spaces  \n\nwith a blank line";
		await createNote(app, "Verbatim", content);
		const written = await mockApp.vault.cachedRead(mockApp.vault.getAbstractFileByPath("Verbatim.md") as never);
		expect(written).toBe(content + "\n");
	});
});

describe("CreateNoteService.createNoteAtDestination", () => {
	it("creates every missing folder parent-to-child, then the note", async () => {
		const { app, mockApp } = createEmptyApp();
		mockApp.vault.seedFolder("Existing");
		const result = await createNoteAtDestination(app, {
			folderPath: "Existing/New/Deeper",
			missingFolders: ["Existing/New", "Existing/New/Deeper"],
			title: "My Note",
			content: "body text",
		});
		expect(result.createdFolders).toEqual(["Existing/New", "Existing/New/Deeper"]);
		expect(result.file.path).toBe("Existing/New/Deeper/My Note.md");
	});

	it("rejects a destination that matches an exclude pattern", async () => {
		const { app, mockApp } = createEmptyApp();
		mockApp.vault.seedFolder("Templates");
		await expect(
			createNoteAtDestination(app, {
				folderPath: "Templates",
				missingFolders: [],
				title: "New Template",
				content: "body",
				excludePatterns: ["Templates"],
			}),
		).rejects.toThrow(DestinationCreateError);
	});

	it("aborts if an expected-existing folder prefix is gone (renamed/deleted since the plan was built)", async () => {
		const { app } = createEmptyApp();
		// "Existing" was never actually created, so a plan claiming it already exists is stale.
		await expect(
			createNoteAtDestination(app, {
				folderPath: "Existing/New",
				missingFolders: ["Existing/New"], // only the leaf is "missing" per the (stale) plan
				title: "My Note",
				content: "body",
			}),
		).rejects.toThrow(/no longer exists/);
	});

	it("aborts on a target note-path collision without touching the vault", async () => {
		const { app, mockApp } = createEmptyApp();
		mockApp.vault.seedFolder("Existing");
		await mockApp.vault.create("Existing/My Note.md", "already here");
		await expect(
			createNoteAtDestination(app, {
				folderPath: "Existing",
				missingFolders: [],
				title: "My Note",
				content: "new content",
			}),
		).rejects.toThrow(/already exists/);
		const content = await mockApp.vault.cachedRead(mockApp.vault.getAbstractFileByPath("Existing/My Note.md") as never);
		expect(content).toBe("already here"); // untouched
	});

	it("reports partial createdFolders when folder creation fails midway", async () => {
		const { app, mockApp } = createEmptyApp();
		const original = mockApp.vault.createFolder.bind(mockApp.vault);
		let calls = 0;
		mockApp.vault.createFolder = async (path: string) => {
			calls++;
			if (calls === 2) throw new Error("simulated failure");
			return original(path);
		};

		let error: DestinationCreateError | undefined;
		try {
			await createNoteAtDestination(app, {
				folderPath: "A/B/C",
				missingFolders: ["A", "A/B", "A/B/C"],
				title: "Note",
				content: "body",
			});
		} catch (e) {
			error = e as DestinationCreateError;
		}
		expect(error).toBeInstanceOf(DestinationCreateError);
		expect(error!.createdFolders).toEqual(["A"]); // first succeeded, second (B) failed
		expect(mockApp.vault.getAbstractFileByPath("A/B/C")).toBeNull();
	});

	it("rejects an invalid segment name before creating anything", async () => {
		const { app, mockApp } = createEmptyApp();
		await expect(
			createNoteAtDestination(app, {
				folderPath: "Bad:Name",
				missingFolders: ["Bad:Name"],
				title: "Note",
				content: "body",
			}),
		).rejects.toThrow(DestinationCreateError);
		expect(mockApp.vault.getAbstractFileByPath("Bad:Name")).toBeNull();
	});

	it("works against the dense fixture vault's existing nested folders", async () => {
		const { app, mockApp, fixture } = createFixtureApp();
		const target = `${fixture.meta.clusters[0].folder}`; // an existing, deeply-nested folder
		const result = await createNoteAtDestination(app, {
			folderPath: target,
			missingFolders: [],
			title: "Brand New Sourdough Note",
			content: "fresh content",
		});
		expect(result.file.path).toBe(`${target}/Brand New Sourdough Note.md`);
		expect(mockApp.vault.getAbstractFileByPath(result.file.path)).not.toBeNull();
	});
});
