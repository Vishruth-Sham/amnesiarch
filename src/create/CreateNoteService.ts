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
 * non-empty destination plan the user has already visibly reviewed and confirmed. Unlike
 * createNote(), a note-path collision here is never silently suffixed -- the caller is expected
 * to have already surfaced an explicit open-existing/edit-title choice before calling this (brief
 * "New-folder and collision behavior"); this function's own collision check exists only as
 * defense-in-depth against a plan that went stale between review and click.
 *
 * `missingFolders` is not trusted as fact about the live vault -- only as the *accepted plan's own
 * classification* of which `folderPath` prefixes the user was told would be created versus which
 * were told to already exist (progressive-destination-composer-addendum.md "Create-service
 * prerequisite correction" -- the technical-review-flagged stale-plan defect). Every prefix is
 * re-preflighted against live `app.vault.getAbstractFileByPath()` state before any mutation:
 * an expected-existing prefix that is no longer a `TFolder` aborts instead of being silently
 * (re)created: only prefixes the plan itself called out as missing may be created, and only after
 * the *entire* plan -- folders and the target note path -- has passed preflight.
 */
export async function createNoteAtDestination(app: App, request: CreateAtDestinationRequest): Promise<CreateAtDestinationResult> {
	const stem = sanitizeTitle(request.title);
	const segments = request.folderPath ? request.folderPath.split("/") : [];

	for (const seg of segments) {
		const err = validateSegmentName(seg, app.vault.configDir);
		if (err) throw new DestinationCreateError(`Can't use "${request.folderPath}" -- ${err}`, []);
	}
	if (request.excludePatterns && request.excludePatterns.length > 0 && matchesExcludePattern(request.folderPath, [...request.excludePatterns])) {
		throw new DestinationCreateError(`"${request.folderPath}" is excluded from this plugin and can't be used as a destination.`, []);
	}

	// Every parent-to-child prefix of folderPath ("A", "A/B", "A/B/C", ...), each classified by
	// the accepted plan as expected-existing or expected-new.
	const prefixes: string[] = [];
	let builtPath = "";
	for (const seg of segments) {
		builtPath = normalizePath(builtPath ? `${builtPath}/${seg}` : seg);
		prefixes.push(builtPath);
	}

	const missingSet = new Set(request.missingFolders.map((p) => normalizePath(p)));
	for (const missing of missingSet) {
		// The accepted plan's own missingFolders must be prefixes of this same folderPath --
		// otherwise the plan itself is stale/mismatched and nothing should be trusted from it.
		if (!prefixes.includes(missing)) {
			throw new DestinationCreateError(`The accepted plan doesn't match "${request.folderPath}" anymore -- please review the destination again.`, []);
		}
	}

	// Preflight every prefix before any mutation.
	for (const prefix of prefixes) {
		const existing = app.vault.getAbstractFileByPath(prefix);
		if (missingSet.has(prefix)) {
			// Expected-new: may be absent (still needs creating) or may already be an exact
			// TFolder created concurrently by something else -- either is fine. Anything else
			// (a conflicting TFile) is not.
			if (existing && !(existing instanceof TFolder)) {
				throw new DestinationCreateError(`"${prefix}" already exists as a note, not a folder.`, []);
			}
		} else {
			// Expected-existing: the plan was built assuming this folder is already there. If
			// it's gone (renamed/deleted between review and click), abort instead of silently
			// recreating it under the user's back.
			if (!(existing instanceof TFolder)) {
				throw new DestinationCreateError(`"${prefix}" no longer exists -- the destination has changed since it was reviewed. Please review it again.`, []);
			}
		}
	}

	// Preflight the target note collision before creating any folders.
	const notePath = normalizePath(request.folderPath ? `${request.folderPath}/${stem}.md` : `${stem}.md`);
	if (app.vault.getAbstractFileByPath(notePath)) {
		// Never overwrite, append, or numeric-suffix a targeted-destination collision (brief).
		throw new DestinationCreateError(`"${notePath}" already exists.`, []);
	}

	// Only now, with the whole plan preflighted, create the missing folders parent-to-child.
	const createdFolders: string[] = [];
	for (const prefix of prefixes) {
		if (!missingSet.has(prefix)) continue;
		const existing = app.vault.getAbstractFileByPath(prefix);
		if (existing instanceof TFolder) continue; // created concurrently since the preflight pass above
		try {
			await app.vault.createFolder(prefix);
			createdFolders.push(prefix);
		} catch (e) {
			console.error("Amnesiarch: failed to create folder", prefix, e);
			throw new DestinationCreateError(`Couldn't create folder "${prefix}" -- see console for details.`, createdFolders);
		}
	}

	// Something could have raced us while the folders above were being created -- re-check once
	// more immediately before the write.
	if (app.vault.getAbstractFileByPath(notePath)) {
		throw new DestinationCreateError(`"${notePath}" already exists.`, createdFolders);
	}

	let file: TFile;
	try {
		file = await app.vault.create(notePath, request.content + "\n");
	} catch (e) {
		console.error("Amnesiarch: failed to create note at destination", notePath, e);
		throw new DestinationCreateError(`Couldn't create the note at "${notePath}" -- see console for details.`, createdFolders);
	}
	return { file, createdFolders };
}
