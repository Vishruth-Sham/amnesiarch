import { App, normalizePath, TFile, TFolder } from "obsidian";
import { validateSegmentName } from "./FolderDestination";
import { matchesExcludePattern } from "../index/ExcludeMatcher";

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

/**
 * Thrown by createNoteAtDestination() for every failure mode. Always carries the folder paths
 * actually created during *this* attempt before the failure -- folder creation isn't atomic
 * (brief "Failure handling"), so a caller must be able to report exactly what exists now without
 * guessing, and must never auto-delete them: another plugin/event may already be relying on them.
 */
export class DestinationCreateError extends Error {
	readonly createdFolders: string[];
	constructor(message: string, createdFolders: string[]) {
		super(message);
		this.name = "DestinationCreateError";
		this.createdFolders = createdFolders;
	}
}

export interface CreateAtDestinationRequest {
	folderPath: string;
	/** Informational only -- see createNoteAtDestination()'s comment on why the live vault, not
	 *  this list, is the actual authority on what needs creating. */
	missingFolders: readonly string[];
	title: string;
	content: string; // exact Quick Capture draft -- append-text invariant, see createNote() above
	excludePatterns?: readonly string[];
}

export interface CreateAtDestinationResult {
	file: TFile;
	createdFolders: string[];
}

/**
 * Creates the folders in `folderPath` (parent-to-child) and then the note inside it, for a
 * non-empty "Describe destination" plan the user has already visibly reviewed and confirmed.
 * Unlike createNote(), a note-path collision here is never silently suffixed -- the caller is
 * expected to have already surfaced an explicit open-existing/change-title/cancel choice before
 * calling this (brief "New-folder and collision behavior"); this function's own collision check
 * exists only as defense-in-depth against a plan that went stale between review and click.
 *
 * Every path is re-derived from live `app.vault.getAbstractFileByPath()` calls here, not trusted
 * from the caller's `missingFolders` snapshot -- folders can be created, renamed, or removed by
 * something else between when the plan was computed and when the user clicks Create (brief:
 * "re-preflights live folder/file state immediately before mutation").
 */
export async function createNoteAtDestination(app: App, request: CreateAtDestinationRequest): Promise<CreateAtDestinationResult> {
	const stem = sanitizeTitle(request.title);
	const segments = request.folderPath ? request.folderPath.split("/") : [];

	for (const seg of segments) {
		const err = validateSegmentName(seg);
		if (err) throw new DestinationCreateError(`Can't use "${request.folderPath}" -- ${err}`, []);
	}
	if (request.excludePatterns && request.excludePatterns.length > 0 && matchesExcludePattern(request.folderPath, [...request.excludePatterns])) {
		throw new DestinationCreateError(`"${request.folderPath}" is excluded from this plugin and can't be used as a destination.`, []);
	}

	const createdFolders: string[] = [];
	let builtPath = "";
	for (const seg of segments) {
		builtPath = normalizePath(builtPath ? `${builtPath}/${seg}` : seg);
		const existing = app.vault.getAbstractFileByPath(builtPath);
		if (existing) {
			// A concurrent actor may have already created exactly this folder -- accept it only
			// if it really is a folder at the exact expected path (brief "Failure handling").
			if (existing instanceof TFolder) continue;
			throw new DestinationCreateError(`"${builtPath}" already exists as a note, not a folder.`, createdFolders);
		}
		try {
			await app.vault.createFolder(builtPath);
			createdFolders.push(builtPath);
		} catch (e) {
			console.error("AI Notes: failed to create folder", builtPath, e);
			throw new DestinationCreateError(`Couldn't create folder "${builtPath}" -- see console for details.`, createdFolders);
		}
	}

	const notePath = normalizePath(request.folderPath ? `${request.folderPath}/${stem}.md` : `${stem}.md`);
	if (app.vault.getAbstractFileByPath(notePath)) {
		// Never overwrite, append, or numeric-suffix a targeted-destination collision (brief).
		throw new DestinationCreateError(`"${notePath}" already exists.`, createdFolders);
	}

	let file: TFile;
	try {
		file = await app.vault.create(notePath, request.content + "\n");
	} catch (e) {
		console.error("AI Notes: failed to create note at destination", notePath, e);
		throw new DestinationCreateError(`Couldn't create the note at "${notePath}" -- see console for details.`, createdFolders);
	}
	return { file, createdFolders };
}
