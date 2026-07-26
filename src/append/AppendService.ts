import { App, TFile } from "obsidian";

export async function appendToNote(app: App, path: string, text: string): Promise<void> {
	const file = app.vault.getAbstractFileByPath(path);
	if (!(file instanceof TFile)) {
		throw new Error(`AI Notes: not a file: ${path}`);
	}
	await app.vault.process(file, (data) => {
		const sep = data.length === 0 || data.endsWith("\n") ? "" : "\n";
		return data + sep + "\n" + text.trim() + "\n";
	});
}

export async function copyToClipboard(text: string): Promise<void> {
	await navigator.clipboard.writeText(text);
}
