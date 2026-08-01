import { App, normalizePath, TFile } from "obsidian";

const MAX_TITLE_WORDS = 8;
const MAX_TITLE_LENGTH = 60;
// Characters that are illegal (or awkward) in Obsidian note filenames across platforms.
const ILLEGAL_FILENAME_CHARS = /[\\/:*?"<>|#^[\]]/g;

/**
 * Best-effort title suggestion from the user's message, for the "no confident match -> create
 * a new note" flow (plans/v2-scale-first.md §4 Phase 4). Deliberately just a suggestion: the
 * UI must show this in an editable field and require explicit confirmation before creating
 * anything, both because auto-generated titles are often wrong and because generating a title
 * is new content, not a rewrite of the user's text -- it sits right at the edge of the
 * append-text invariant (CLAUDE.md), so it should never be silently applied.
 */
export function proposeTitle(text: string): string {
	const firstLine = text.split("\n")[0]?.trim() ?? "";
	const words = firstLine.split(/\s+/).filter(Boolean).slice(0, MAX_TITLE_WORDS);
	let title = words.join(" ").replace(ILLEGAL_FILENAME_CHARS, "").trim();
	if (title.length > MAX_TITLE_LENGTH) title = title.slice(0, MAX_TITLE_LENGTH).trim();
	return title || "Untitled note";
}

/** Sanitize a user-edited title into a safe filename stem (no path separators, no illegal chars). */
function sanitizeTitle(title: string): string {
	const cleaned = title.replace(ILLEGAL_FILENAME_CHARS, "").trim();
	return cleaned || "Untitled note";
}

/**
 * Create a new note at the vault root containing `content`, resolving filename collisions by
 * appending " 1", " 2", etc. -- the same convention Obsidian's own "New note" command uses.
 *
 * Append-text invariant (CLAUDE.md): `content` is the user's exact typed text and must reach
 * disk unmodified -- leading/trailing whitespace and blank lines included. The trailing
 * newline added below is a structural file-ending convention, not a change to the payload.
 */
export async function createNote(app: App, title: string, content: string): Promise<TFile> {
	const stem = sanitizeTitle(title);
	let candidate = normalizePath(`${stem}.md`);
	let suffix = 1;
	while (app.vault.getAbstractFileByPath(candidate)) {
		candidate = normalizePath(`${stem} ${suffix}.md`);
		suffix++;
	}
	return app.vault.create(candidate, content + "\n");
}
