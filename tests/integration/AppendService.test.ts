import { describe, expect, it } from "vitest";
import { appendToNote } from "../../src/append/AppendService";
import { createEmptyApp } from "../support/testApp";

describe("AppendService.appendToNote", () => {
	it("appends exact text (append-text invariant) to an empty file", async () => {
		const { app, mockApp } = createEmptyApp();
		await mockApp.vault.create("Note.md", "");
		await appendToNote(app, "Note.md", "  captured thought with trailing spaces  ");
		const content = await mockApp.vault.cachedRead(mockApp.vault.getAbstractFileByPath("Note.md") as never);
		expect(content).toBe("\n  captured thought with trailing spaces  \n");
	});

	it("adds a separating blank line when the file already ends with a newline", async () => {
		const { app, mockApp } = createEmptyApp();
		await mockApp.vault.create("Note.md", "Existing content.\n");
		await appendToNote(app, "Note.md", "New captured text.");
		const content = await mockApp.vault.cachedRead(mockApp.vault.getAbstractFileByPath("Note.md") as never);
		expect(content).toBe("Existing content.\n\nNew captured text.\n");
	});

	it("adds an extra newline first when the file does NOT end with a newline", async () => {
		const { app, mockApp } = createEmptyApp();
		await mockApp.vault.create("Note.md", "Existing content with no trailing newline");
		await appendToNote(app, "Note.md", "New captured text.");
		const content = await mockApp.vault.cachedRead(mockApp.vault.getAbstractFileByPath("Note.md") as never);
		expect(content).toBe("Existing content with no trailing newline\n\nNew captured text.\n");
	});

	it("preserves internal blank lines and leading/trailing whitespace in the appended text exactly", async () => {
		const { app, mockApp } = createEmptyApp();
		await mockApp.vault.create("Note.md", "Existing.\n");
		const captured = "line one\n\nline two   \n   line three";
		await appendToNote(app, "Note.md", captured);
		const content = await mockApp.vault.cachedRead(mockApp.vault.getAbstractFileByPath("Note.md") as never);
		expect(content).toBe(`Existing.\n\n${captured}\n`);
	});

	it("throws when the path does not point at a file (missing or a folder)", async () => {
		const { app, mockApp } = createEmptyApp();
		mockApp.vault.seedFolder("SomeFolder");
		await expect(appendToNote(app, "SomeFolder", "text")).rejects.toThrow();
		await expect(appendToNote(app, "Nonexistent.md", "text")).rejects.toThrow();
	});
});
