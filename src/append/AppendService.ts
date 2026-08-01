import { App, TFile } from "obsidian";

/**
 * Append-text invariant (CLAUDE.md): `text` is the user's exact typed content and must reach
 * disk unmodified, including any leading/trailing whitespace and blank lines. `.trim()` is
 * only ever appropriate for the caller's whitespace-only-input check and embedding query --
 * never here. The blank line and trailing newline added below are structural separators
 * around the payload, not modifications to it.
 */
export async function appendToNote(app: App, path: string, text: string): Promise<void> {
	const file = app.vault.getAbstractFileByPath(path);
	if (!(file instanceof TFile)) {
		throw new Error(`AI Notes: not a file: ${path}`);
	}
	await app.vault.process(file, (data) => {
		const sep = data.length === 0 || data.endsWith("\n") ? "" : "\n";
		return data + sep + "\n" + text + "\n";
	});
}

export async function copyToClipboard(text: string): Promise<void> {
	await navigator.clipboard.writeText(text);
}
