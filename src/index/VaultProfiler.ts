import { NoteEntry } from "../types";

/**
 * Cheap, purely metadata-derived measurements of "what kind of vault is this" -- used to
 * derive per-vault structural search weights instead of the single global constant v1 used
 * (see plans/v2-scale-first.md §2.5/§4 Phase 2). Nothing here reads note content or calls the
 * embedding model; it's a pass over data VaultIndexer already captured.
 */
export interface VaultProfile {
	noteCount: number;
	/** Fraction of notes with at least one tag. */
	tagCoverage: number;
	/** Unique tags / tagged notes. High => idiosyncratic one-off tags; low => a shared taxonomy. */
	tagVocabRatio: number;
	/** Fraction of notes not sitting at the vault root. */
	folderCoverage: number;
	/** Unique folder chains / notes. Reported for visibility/future tuning -- see
	 *  plans/v2-scale-first.md open question §7.5; not currently fed into weight derivation. */
	folderBranching: number;
	/** Mean outgoingLinks.length across all notes. */
	linkDensity: number;
	/** Fraction of titles with >=2 alpha-only tokens of length >=3 -- catches zettelkasten-style
	 *  UID/timestamp titles (near 0) vs natural-language titles (near 1). */
	titleInformativeness: number;
	/** Frontmatter keys present on >=5% of notes, mapped to the fraction of notes carrying them. */
	schemaKeys: Record<string, number>;
}

const SCHEMA_KEY_MIN_FRACTION = 0.05;

function isInformativeTitle(title: string): boolean {
	const tokens = title
		.toLowerCase()
		.split(/[^a-z]+/)
		.filter((t) => t.length >= 3);
	return tokens.length >= 2;
}

export function computeVaultProfile(entries: NoteEntry[]): VaultProfile {
	const noteCount = entries.length;
	if (noteCount === 0) {
		return {
			noteCount: 0,
			tagCoverage: 0,
			tagVocabRatio: 0,
			folderCoverage: 0,
			folderBranching: 0,
			linkDensity: 0,
			titleInformativeness: 0,
			schemaKeys: {},
		};
	}

	let taggedNotes = 0;
	const uniqueTags = new Set<string>();
	let notesNotAtRoot = 0;
	const uniqueFolderChains = new Set<string>();
	let totalOutgoingLinks = 0;
	let informativeTitles = 0;
	const schemaKeyCounts = new Map<string, number>();

	for (const entry of entries) {
		if (entry.tags.length > 0) taggedNotes++;
		for (const tag of entry.tags) uniqueTags.add(tag);

		if (entry.folderChain.length > 0) notesNotAtRoot++;
		uniqueFolderChains.add(entry.folderChain.join("/"));

		totalOutgoingLinks += entry.outgoingLinks.length;

		if (isInformativeTitle(entry.title)) informativeTitles++;

		for (const key of Object.keys(entry.frontmatter)) {
			schemaKeyCounts.set(key, (schemaKeyCounts.get(key) ?? 0) + 1);
		}
	}

	const schemaKeys: Record<string, number> = {};
	for (const [key, count] of schemaKeyCounts) {
		const fraction = count / noteCount;
		if (fraction >= SCHEMA_KEY_MIN_FRACTION) schemaKeys[key] = fraction;
	}

	return {
		noteCount,
		tagCoverage: taggedNotes / noteCount,
		tagVocabRatio: taggedNotes > 0 ? uniqueTags.size / taggedNotes : 0,
		folderCoverage: notesNotAtRoot / noteCount,
		folderBranching: uniqueFolderChains.size / noteCount,
		linkDensity: totalOutgoingLinks / noteCount,
		titleInformativeness: informativeTitles / noteCount,
		schemaKeys,
	};
}
