import { TFolder, normalizePath } from "obsidian";
import { matchesExcludePattern } from "../index/ExcludeMatcher";

/**
 * Deterministic, dependency-free parser + sibling-only resolver for Quick Capture's optional
 * "Describe destination" field (research/implementation-handoffs/quick-capture-folder-destination.md).
 * No LLM, embeddings, or network call -- constrained-grammar string parsing plus live folder
 * metadata. Every fuzzy correction, ambiguity, and collision is suggestion-only: nothing here
 * ever mutates the vault or silently substitutes a name the user didn't type (append-text
 * invariant's routing-metadata cousin -- destination text itself never becomes note content
 * either, enforced by the caller passing only the original Quick Capture draft to the create
 * service, never anything from this module).
 */

// ---------- public types (see brief's "Interfaces" section) ----------

export interface DestinationParse {
	segments: RequestedFolderSegment[];
	explicitTitle: string | null;
	/** "structured": a hierarchy was confidently identified (including the empty-input case).
	 *  "weak": non-empty text that didn't parse into a reliable segment order -- never silently
	 *  routed; the caller must show guidance copy instead of a plan (brief "Ambiguity handling"). */
	confidence: "structured" | "weak";
	warnings: string[];
}

export interface RequestedFolderSegment {
	/** Exact display spelling as typed -- never the normalized comparison form. */
	name: string;
	/** "create-new": introduced by an explicit `New folder X` (or bare `Create X under Y`)
	 *  command -- never fuzzy-corrected, per "Requested new-folder leaf" policy.
	 *  "resolve-or-create": an ordinary ancestor (or a plain-path leaf with no explicit creation
	 *  verb) -- eligible for exact/fuzzy/ambiguous/create resolution like any ancestor. */
	intent: "resolve-or-create" | "create-new";
}

export interface DestinationParseError {
	/** Human-readable, shown verbatim as inline card copy -- never a Levenshtein score or a
	 *  formal grammar description (brief "Copy beneath the field... not a formal grammar"). */
	reason: string;
}

export function isDestinationParseError(x: DestinationParse | DestinationParseError): x is DestinationParseError {
	return "reason" in x;
}

export interface FolderInfo {
	name: string;
	path: string;
	/** "" for direct children of the vault root. */
	parentPath: string;
}

export interface FolderSnapshot {
	childrenByParent: ReadonlyMap<string, readonly FolderInfo[]>;
}

export interface FuzzyPolicy {
	maxDistanceShort: number; // normalized length <= 4
	maxDistanceMedium: number; // normalized length 5-8
	maxDistanceLong: number; // normalized length >= 9
	minimumSimilarity: number;
	distanceAmbiguityMargin: number;
	similarityAmbiguityMargin: number;
}

/** Balanced policy selected by the standalone POC (research/experiment-results/
 *  folder-destination-poc/README.md): best calibration/held-out complete-plan accuracy with
 *  zero false automatic corrections. Synthetic evidence only -- see the brief's "Evidence
 *  status"; not tuned against a real vault yet. */
export const BALANCED_FUZZY_POLICY: FuzzyPolicy = {
	maxDistanceShort: 1,
	maxDistanceMedium: 2,
	maxDistanceLong: 2,
	minimumSimilarity: 0.72,
	distanceAmbiguityMargin: 1,
	similarityAmbiguityMargin: 0.08,
};

const SHORT_MAX_LEN = 4;
const MEDIUM_MAX_LEN = 8;
/** A candidate below the normal eligibility bar is shown only as one of the ambiguous choices,
 *  never as an auto-proposed correction -- POC's ".55 similarity floor for this fallback". */
const PREFIX_FALLBACK_SIMILARITY = 0.55;
const AMBIGUITY_CHOICE_LIMIT = 3;

export type SegmentResolution =
	| { kind: "exact"; requested: string; folder: FolderInfo }
	| { kind: "fuzzy"; requested: string; folder: FolderInfo; acknowledged: boolean }
	| { kind: "ambiguous"; requested: string; parentPath: string; choices: FolderInfo[] }
	| { kind: "create"; requested: string; path: string }
	| { kind: "collision"; requested: string; folder: FolderInfo }
	| { kind: "invalid"; requested: string; reason: string };

export type TitleSource = "capture-proposal" | "destination" | "user-edited";

export interface DestinationPlan {
	status: "root" | "invalid" | "needs-confirmation" | "ambiguous" | "collision" | "ready";
	segments: SegmentResolution[];
	folderPath: string;
	noteTitle: string;
	notePath: string;
	titleSource: TitleSource;
	missingFolders: string[];
	warnings: string[];
}

export interface DestinationChoice {
	/** Stable parent path + segment position + normalized requested text -- see
	 *  segmentChoiceKey(). Included on the value (not just as the map key) so a stored choice is
	 *  still self-describing if ever logged/inspected. */
	segmentKey: string;
	resolution: { kind: "existing"; path: string } | { kind: "create"; name: string };
}

// ---------- normalization + edit distance ----------

/** Comparison-only normalization (brief "Normalization"): never applied to a created folder's
 *  actual display name -- callers always create/display `segment.name`/override names verbatim. */
export function normalizeForComparison(s: string): string {
	return s
		.trim()
		.normalize("NFKC")
		.toLowerCase()
		.replace(/[-_]+/g, " ")
		.replace(/[^\p{L}\p{N}\s]+/gu, "")
		.replace(/\s+/g, " ")
		.trim();
}

/** Two-row dynamic-programming Levenshtein distance -- O(min(a,b)) memory, no full matrix
 *  retention (brief "Performance constraints"). Operates on already-normalized strings. */
export function levenshteinDistance(a: string, b: string): number {
	if (a === b) return 0;
	const alen = a.length;
	const blen = b.length;
	if (alen === 0) return blen;
	if (blen === 0) return alen;

	let prev = new Array<number>(blen + 1);
	let curr = new Array<number>(blen + 1);
	for (let j = 0; j <= blen; j++) prev[j] = j;

	for (let i = 1; i <= alen; i++) {
		curr[0] = i;
		for (let j = 1; j <= blen; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
		}
		[prev, curr] = [curr, prev];
	}
	return prev[blen];
}

function similarity(a: string, b: string): number {
	const na = normalizeForComparison(a);
	const nb = normalizeForComparison(b);
	const dist = levenshteinDistance(na, nb);
	return 1 - dist / Math.max(na.length, nb.length, 1);
}

function isPrefixMatch(normA: string, normB: string): boolean {
	return normA.length > 0 && normB.length > 0 && (normB.startsWith(normA) || normA.startsWith(normB));
}

// ---------- segment / path validation ----------

export const MAX_DESTINATION_LENGTH = 500;
export const MAX_SEGMENTS = 20;
export const MAX_SEGMENT_LENGTH = 200;

// Same illegal set CreateNoteService.ts uses for filenames, plus separators (a single path
// segment must never itself contain a separator -- those are stripped during parsing already).
const ILLEGAL_SEGMENT_CHARS = /[\\/:*?"<>|#^[\]]/;
// eslint-disable-next-line no-control-regex -- intentional: rejecting control characters in a
// folder name is the actual safety check here, not a mistake to be "fixed" by removing them.
const CONTROL_CHAR_RE = /[\x00-\x1f\x7f]/;

/** Default fallback for `validateSegmentName()`'s `configDir` parameter -- Obsidian's actual
 *  config folder is user-configurable (`Vault#configDir`), so this is only correct for callers
 *  that genuinely have no live `App`/`Vault` to ask (pure-logic call sites, e.g. within this same
 *  module) -- every call site with access to a real vault should pass its actual configDir. */
const DEFAULT_CONFIG_DIR = ".obsidian";

/** Returns a human-readable rejection reason, or null when `name` is safe to use as one path
 *  segment. Called both while building a plan (so invalid segments render inline, not as a
 *  generic Notice) and again, defense-in-depth, immediately before mutation.
 *  `configDir` defaults to Obsidian's usual ".obsidian" but should be passed as the vault's real
 *  `Vault#configDir` wherever a live `App` is available -- it's user-configurable. */
export function validateSegmentName(name: string, configDir: string = DEFAULT_CONFIG_DIR): string | null {
	if (name.length === 0) return "That folder name can't be empty.";
	if (name.length > MAX_SEGMENT_LENGTH) return "That folder name is too long.";
	if (name === "." || name === "..") return `"${name}" isn't allowed as a folder name.`;
	if (name.toLowerCase() === configDir.toLowerCase()) return `"${configDir}" is reserved by Obsidian.`;
	if (CONTROL_CHAR_RE.test(name)) return "That folder name contains unsupported characters.";
	if (ILLEGAL_SEGMENT_CHARS.test(name)) return 'Folder names can\'t contain \\ / : * ? " < > | # ^ [ ]';
	if (/[ .]$/.test(name)) return "Folder names can't end with a space or a period on some platforms.";
	return null;
}

/** Rejects obviously unsafe raw destination text before parsing even starts -- absolute paths,
 *  traversal, backslashes, and `.obsidian` mentions. Segment-level validation (above) is the
 *  authoritative, defense-in-depth check; this is a fast, cheap first filter so the parser never
 *  has to reason about traversal syntax inside its grammar rules. */
const UNSAFE_RAW_RE = /\.obsidian|(^|[/\\\s])\.\.($|[/\\\s])|^\s*[/\\]|\\|\b(?:under|inside|in|within|beneath)\s+[/\\]/i;

function joinPath(parentPath: string, name: string): string {
	return normalizePath(parentPath ? `${parentPath}/${name}` : name);
}

/** Public wrapper around joinPath() -- the progressive composer needs to compute a not-yet-
 *  created folder token's path outside this module. */
export function joinFolderPath(parentPath: string, name: string): string {
	return joinPath(parentPath, name);
}

// Mirrors CreateNoteService.ts's private sanitizeTitle() -- duplicated (not imported) so this
// module never depends on the create service, avoiding a create-service <-> destination-module
// import cycle (CreateNoteService already imports validateSegmentName from here). An explicit
// destination title comes straight from raw user text and needs the same illegal-character
// stripping a manually-typed title gets, so the preview's notePath always matches what
// createNoteAtDestination() will actually write.
const ILLEGAL_FILENAME_CHARS = /[\\/:*?"<>|#^[\]]/g;
export function sanitizeTitleForPath(title: string): string {
	const cleaned = title.replace(ILLEGAL_FILENAME_CHARS, "").trim();
	return cleaned || "Untitled note";
}

// ---------- parser ----------

const RELATIONAL_RE = /(?:^|\s+)(?:under|inside|within|beneath|in)(?:\s+|$)/i;

// Ordered most- to least-specific so a longer, more descriptive phrase (e.g. "call the note
// "X"") is consumed whole rather than a shorter generic pattern matching only part of it and
// leaving connector words like "call the" stranded in the remaining path text.
const TITLE_PATTERNS: RegExp[] = [
	/(?:note\s+)?(?:called|named)\s+["“]([^"”]+)["”]/i,
	/create\s+(?:a\s+)?note\s+["“]([^"”]+)["”]/i,
	/call(?:ed|ing)?\s+(?:the\s+)?note\s+["“]([^"”]+)["”]/i,
	/\bnote\s+["“]([^"”]+)["”]/i,
	/create\s+["“]([^"”]+)["”](?=\s+(?:under|inside|in|within|beneath)\b|$)/i,
];
const UNQUOTED_TITLE_RE = /\b(?:called|named)\s+([^,]+?)(?=\s+(?:under|inside|in|within|beneath)\b|$)/i;

function extractExplicitTitle(s: string): { title: string | null; rest: string } {
	for (const re of TITLE_PATTERNS) {
		const m = re.exec(s);
		if (m && m[1] && m.index !== undefined) {
			const title = m[1].trim();
			if (title) return { title, rest: (s.slice(0, m.index) + " " + s.slice(m.index + m[0].length)).trim() };
		}
	}
	const m = UNQUOTED_TITLE_RE.exec(s);
	if (m && m[1] && m.index !== undefined) {
		const title = m[1].trim();
		if (title) return { title, rest: (s.slice(0, m.index) + " " + s.slice(m.index + m[0].length)).trim() };
	}
	return { title: null, rest: s };
}

const LEADING_PLACEMENT_FILLER_RE = /^\s*(?:put|place|file)\s+(?:this|it)\s+/i;

function stripLeadingPlacementFiller(s: string): string {
	return s.replace(LEADING_PLACEMENT_FILLER_RE, "");
}

function stripTrailingConnectors(s: string): string {
	return s.replace(/\s+and\s*$/i, "").trim();
}

const EXPLICIT_FOLDER_VERB_RE = /^\s*(?:new|create|make)\s+(?:a\s+)?folder\s+/i;
const BARE_CREATE_VERB_RE = /^\s*(?:new|create|make)\s+(?:a\s+)?(?!note\b)/i;

/** Detects "New folder X ..." / "Create folder X ..." / bare "Create X under Y" (no "note", no
 *  quotes -- see brief's supported shape "Create Experiments under Learning/AI"). Only the bare
 *  form is suppressed when an explicit title was already found, since a title means this is a
 *  note-creation instruction, not a folder-creation one. */
function stripCreationVerb(s: string, hasExplicitTitle: boolean): { isNewFolderLeaf: boolean; rest: string } {
	const explicitMatch = EXPLICIT_FOLDER_VERB_RE.exec(s);
	if (explicitMatch) {
		return { isNewFolderLeaf: true, rest: s.slice(explicitMatch[0].length) };
	}
	if (!hasExplicitTitle && BARE_CREATE_VERB_RE.test(s)) {
		return { isNewFolderLeaf: true, rest: s.replace(BARE_CREATE_VERB_RE, "") };
	}
	return { isNewFolderLeaf: false, rest: s };
}

/** Strips harmless structural filler ("folder", "which is") the grammar tolerates anywhere,
 *  per the POC and the brief's "Supported instruction shapes" ("AI folder which is inside
 *  Learning"). Known limitation, inherited from the POC: a real folder literally named "Folder"
 *  can't be targeted by name through this field. */
function stripFillerWords(s: string): string {
	return s
		.replace(/\bwhich\s+is\b/gi, " ")
		.replace(/\bfolder\b/gi, " ")
		.replace(/\s{2,}/g, " ")
		.trim();
}

function splitHierarchy(s: string, isNewFolderLeaf: boolean): { segments: string[]; weak: boolean } {
	const trimmed = s.trim();
	if (!trimmed) return { segments: [], weak: true };

	if (/[/>]/.test(trimmed)) {
		const relMatch = RELATIONAL_RE.exec(trimmed);
		let leafBefore = "";
		let pathPart = trimmed;
		if (relMatch && relMatch.index !== undefined) {
			leafBefore = trimmed.slice(0, relMatch.index).trim();
			pathPart = trimmed.slice(relMatch.index + relMatch[0].length).trim();
		}
		const parentSegments = pathPart
			.split(/[/>]/)
			.map((x) => x.trim())
			.filter(Boolean);
		const segments = isNewFolderLeaf && leafBefore ? [...parentSegments, leafBefore] : parentSegments;
		return { segments, weak: segments.length === 0 };
	}

	const parts = trimmed
		.split(RELATIONAL_RE)
		.map((x) => x.trim())
		.filter(Boolean);
	if (parts.length > 1) {
		// "abc under AI inside Learning" -- relational chains read leaf-first; reverse to
		// root-to-leaf order for sibling-by-sibling resolution.
		return { segments: [...parts].reverse(), weak: false };
	}
	// A single bare phrase with no discernible parent/child structure at all is too weak to
	// trust as a hierarchy -- never silently guess (brief "Ambiguity handling").
	return { segments: [], weak: true };
}

/** Converts constrained destination text into ordered root-to-leaf segments plus an optional
 *  explicit title. Performs no vault lookup and no mutation -- see module doc. */
export function parseDestinationInstruction(raw: string): DestinationParse | DestinationParseError {
	const trimmed = raw.trim();
	if (trimmed.length === 0) {
		return { segments: [], explicitTitle: null, confidence: "structured", warnings: [] };
	}
	if (trimmed.length > MAX_DESTINATION_LENGTH) {
		return { reason: `Destination text is too long (max ${MAX_DESTINATION_LENGTH} characters).` };
	}
	if (UNSAFE_RAW_RE.test(trimmed)) {
		return { reason: "That looks like an absolute path or a reserved location, which isn't allowed here." };
	}

	const { title, rest: afterTitle } = extractExplicitTitle(trimmed);
	const afterConnectors = stripTrailingConnectors(afterTitle);
	const afterFiller1 = stripLeadingPlacementFiller(afterConnectors);
	const { isNewFolderLeaf, rest: afterVerb } = stripCreationVerb(afterFiller1, title !== null);
	const cleaned = stripFillerWords(afterVerb);

	const { segments: rawSegments, weak } = splitHierarchy(cleaned, isNewFolderLeaf);

	if (rawSegments.length === 0) {
		return {
			reason:
				'I couldn\'t determine the folder order. Try a path like "Learning/AI/Experiments" or "Experiments under AI inside Learning."',
		};
	}
	if (rawSegments.length > MAX_SEGMENTS) {
		return { reason: "That destination has too many folder levels." };
	}

	const segments: RequestedFolderSegment[] = rawSegments.map((name, i) => ({
		name,
		intent: isNewFolderLeaf && i === rawSegments.length - 1 ? "create-new" : "resolve-or-create",
	}));

	return { segments, explicitTitle: title, confidence: weak ? "weak" : "structured", warnings: [] };
}

// ---------- folder snapshot ----------

/** Groups live `TFolder`s by direct parent path -- the folder source of truth (brief: "do not
 *  derive folders only from plugin.cache, because empty folders... are absent from the note
 *  cache"). Root's own path is represented as "" per FolderInfo.parentPath; root itself is never
 *  a candidate in ordinary sibling choices. */
export function buildFolderSnapshot(folders: readonly TFolder[]): FolderSnapshot {
	const map = new Map<string, FolderInfo[]>();
	for (const f of folders) {
		if (f.isRoot()) continue;
		const parentPath = f.parent && !f.parent.isRoot() ? f.parent.path : "";
		const info: FolderInfo = { name: f.name, path: f.path, parentPath };
		const list = map.get(parentPath);
		if (list) list.push(info);
		else map.set(parentPath, [info]);
	}
	return { childrenByParent: map };
}

// ---------- resolver ----------

export function segmentChoiceKey(index: number, parentPath: string, requested: string): string {
	return `${index}::${parentPath}::${normalizeForComparison(requested)}`;
}

function resolveOneSegment(requested: string, siblings: readonly FolderInfo[], policy: FuzzyPolicy): SegmentResolution {
	const normReq = normalizeForComparison(requested);
	const exact = siblings.find((f) => normalizeForComparison(f.name) === normReq);
	if (exact) return { kind: "exact", requested, folder: exact };

	if (siblings.length === 0) return { kind: "create", requested, path: "" };

	const scored = siblings
		.map((f) => ({ folder: f, distance: levenshteinDistance(normReq, normalizeForComparison(f.name)), sim: similarity(requested, f.name) }))
		.sort((a, b) => a.distance - b.distance || b.sim - a.sim);

	const best = scored[0];
	const next = scored[1];
	const maxDistance = normReq.length <= SHORT_MAX_LEN ? policy.maxDistanceShort : normReq.length <= MEDIUM_MAX_LEN ? policy.maxDistanceMedium : policy.maxDistanceLong;
	const eligible = best.distance <= maxDistance && best.sim >= policy.minimumSimilarity;
	const close = !!next && (next.distance - best.distance <= policy.distanceAmbiguityMargin || Math.abs(next.sim - best.sim) < policy.similarityAmbiguityMargin);

	if (eligible && !close) return { kind: "fuzzy", requested, folder: best.folder, acknowledged: false };

	const bestIsPrefixLike = isPrefixMatch(normReq, normalizeForComparison(best.folder.name)) && best.sim >= PREFIX_FALLBACK_SIMILARITY;
	if (eligible || bestIsPrefixLike) {
		return {
			kind: "ambiguous",
			requested,
			parentPath: best.folder.parentPath,
			choices: scored.slice(0, AMBIGUITY_CHOICE_LIMIT).map((s) => s.folder),
		};
	}
	return { kind: "create", requested, path: "" };
}

/** Applies a transient user choice on top of a freshly recomputed natural resolution. Comparing
 *  against the natural result (rather than trusting the override blindly) is what lets an
 *  accepted fuzzy correction keep its "corrected from X" framing while a deliberately-chosen
 *  alternate sibling (via "Choose another folder" or an ambiguity pick) reads as a plain, direct
 *  match instead. */
function resolveAncestorSegment(
	requested: string,
	siblings: readonly FolderInfo[],
	policy: FuzzyPolicy,
	override: DestinationChoice | undefined,
): SegmentResolution {
	const natural = resolveOneSegment(requested, siblings, policy);
	if (!override) return natural;

	const resolution = override.resolution;
	if (resolution.kind === "existing") {
		const targetPath = resolution.path;
		const folder = siblings.find((f) => f.path === targetPath);
		if (!folder) return natural; // stale choice (folder renamed/removed) -- fall back to a fresh read
		if (natural.kind === "fuzzy" && natural.folder.path === folder.path) {
			return { kind: "fuzzy", requested, folder, acknowledged: true };
		}
		return { kind: "exact", requested, folder };
	}
	return { kind: "create", requested: resolution.name || requested, path: "" };
}

/** Resolves a `create-new` segment: never fuzzy-corrected, only ever exact-match-as-collision or
 *  create-verbatim. Despite the old name ("leaf"), `resolveFolderDestination()` already dispatches
 *  on `seg.intent` at every index, not just the last one -- `create-new` is a documented, tested
 *  contract at any segment position (progressive-destination-composer-addendum.md "Additive
 *  segment-suggestion API"), e.g. the composer's explicit slash/Create-button commits. */
function resolveExplicitNewSegment(requested: string, siblings: readonly FolderInfo[], override: DestinationChoice | undefined): SegmentResolution {
	if (override) {
		const resolution = override.resolution;
		if (resolution.kind === "existing") {
			const targetPath = resolution.path;
			const folder = siblings.find((f) => f.path === targetPath);
			if (folder) return { kind: "exact", requested, folder };
		} else {
			return { kind: "create", requested: resolution.name || requested, path: "" };
		}
	}
	const normReq = normalizeForComparison(requested);
	const collisionFolder = siblings.find((f) => normalizeForComparison(f.name) === normReq);
	if (collisionFolder) return { kind: "collision", requested, folder: collisionFolder };
	return { kind: "create", requested, path: "" };
}

export type FolderSegmentSuggestion =
	| { kind: "empty" }
	| { kind: "exact"; folder: FolderInfo }
	| { kind: "fuzzy"; requested: string; folder: FolderInfo }
	| { kind: "ambiguous"; requested: string }
	| { kind: "none"; requested: string };

/**
 * Pure per-keystroke suggestion for the progressive destination composer
 * (progressive-destination-composer-addendum.md "Additive segment-suggestion API"). Considers
 * only `parentPath`'s direct children in `snapshot` -- never a global/whole-vault search, same
 * bound as resolveFolderDestination(). Returns a suggestion only: nothing here commits a segment,
 * mutates the vault, or is required to change just because a match is temporarily unique.
 */
export function suggestFolderSegment(requested: string, parentPath: string, snapshot: FolderSnapshot, policy: FuzzyPolicy = BALANCED_FUZZY_POLICY): FolderSegmentSuggestion {
	const trimmed = requested.trim();
	if (!trimmed) return { kind: "empty" };
	const siblings = snapshot.childrenByParent.get(parentPath) ?? [];
	const res = resolveOneSegment(trimmed, siblings, policy);
	if (res.kind === "exact") return { kind: "exact", folder: res.folder };
	if (res.kind === "fuzzy") return { kind: "fuzzy", requested: trimmed, folder: res.folder };
	if (res.kind === "ambiguous") return { kind: "ambiguous", requested: trimmed };
	return { kind: "none", requested: trimmed };
}

/** The composer's `/`-commit rule (addendum "Explicit new folder"): a normalized *exact* direct
 *  sibling only -- fuzzy matches are never auto-applied on slash ("never fuzzy-correct a
 *  slash-committed new folder"). Deliberately a separate, stricter check from
 *  suggestFolderSegment()'s eligible-fuzzy case above. */
export function findExactSibling(requested: string, parentPath: string, snapshot: FolderSnapshot): FolderInfo | null {
	const normReq = normalizeForComparison(requested);
	if (!normReq) return null;
	const siblings = snapshot.childrenByParent.get(parentPath) ?? [];
	return siblings.find((f) => normalizeForComparison(f.name) === normReq) ?? null;
}

/**
 * Walks requested segments root-to-leaf, considering only direct children of the
 * already-resolved parent at each step (never a global folder search -- brief acceptance
 * criterion 6). Stops at the first unresolved ambiguity/unacknowledged-fuzzy/collision/invalid
 * segment; descendants beyond that point are not evaluated until the caller supplies a matching
 * `choices` entry and calls again. `fallbackTitle` should already be `proposeTitle(draftText)` --
 * this module has no knowledge of the Quick Capture draft itself.
 */
export function resolveFolderDestination(
	parsed: DestinationParse,
	snapshot: FolderSnapshot,
	choices: ReadonlyMap<string, DestinationChoice>,
	fallbackTitle: string,
	policy: FuzzyPolicy = BALANCED_FUZZY_POLICY,
	excludePatterns: readonly string[] = [],
	// Threaded down into validateSegmentName() below -- see its own doc comment. Callers with a
	// live App should pass `app.vault.configDir`; the default only applies to pure-logic callers.
	configDir: string = DEFAULT_CONFIG_DIR,
): DestinationPlan {
	const noteTitle = parsed.explicitTitle ? sanitizeTitleForPath(parsed.explicitTitle) : fallbackTitle;
	const titleSource: TitleSource = parsed.explicitTitle ? "destination" : "capture-proposal";

	if (parsed.segments.length === 0) {
		if (parsed.confidence === "structured") {
			// Zero segments with a non-null explicitTitle is unreachable from the old sentence
			// parser (a blank destination is its only "structured, no segments" case) but is a
			// real state from the composer's zero-folder-tokens-plus-typed-title case ("Model
			// Evaluation" with no folder committed) -- use the already-computed noteTitle/
			// titleSource above rather than re-deriving fallbackTitle unconditionally.
			return {
				status: "root",
				segments: [],
				folderPath: "",
				noteTitle,
				notePath: normalizePath(`${noteTitle}.md`),
				titleSource,
				missingFolders: [],
				warnings: [],
			};
		}
		return {
			status: "invalid",
			segments: [],
			folderPath: "",
			noteTitle,
			notePath: "",
			titleSource,
			missingFolders: [],
			warnings: parsed.warnings,
		};
	}

	const resolutions: SegmentResolution[] = [];
	const missingFolders: string[] = [];
	let parentPath = "";
	let status: DestinationPlan["status"] = "ready";
	const warnings: string[] = [...parsed.warnings];

	for (let i = 0; i < parsed.segments.length; i++) {
		const seg = parsed.segments[i];
		const validationError = validateSegmentName(seg.name, configDir);
		const siblings = snapshot.childrenByParent.get(parentPath) ?? [];

		let res: SegmentResolution;
		if (validationError) {
			res = { kind: "invalid", requested: seg.name, reason: validationError };
		} else {
			const key = segmentChoiceKey(i, parentPath, seg.name);
			const override = choices.get(key);
			res = seg.intent === "create-new" ? resolveExplicitNewSegment(seg.name, siblings, override) : resolveAncestorSegment(seg.name, siblings, policy, override);
		}

		if (res.kind === "create" && !res.path) {
			res = { ...res, path: joinPath(parentPath, res.requested) };
		}
		resolutions.push(res);

		let stop = false;
		switch (res.kind) {
			case "exact":
				parentPath = res.folder.path;
				break;
			case "fuzzy":
				if (res.acknowledged) {
					parentPath = res.folder.path;
				} else {
					status = "needs-confirmation";
					stop = true;
				}
				break;
			case "create":
				missingFolders.push(res.path);
				parentPath = res.path;
				break;
			case "ambiguous":
				status = "ambiguous";
				stop = true;
				break;
			case "collision":
				status = "collision";
				stop = true;
				break;
			case "invalid":
				status = "invalid";
				warnings.push(res.reason);
				stop = true;
				break;
		}
		if (stop) break;
	}

	const resolvedAll = resolutions.length === parsed.segments.length && status === "ready";
	const folderPath = resolvedAll ? parentPath : "";

	if (resolvedAll && excludePatterns.length > 0 && matchesExcludePattern(folderPath, [...excludePatterns])) {
		return {
			status: "invalid",
			segments: resolutions,
			folderPath: "",
			noteTitle,
			notePath: "",
			titleSource,
			missingFolders: [],
			warnings: [...warnings, "That destination is excluded from this plugin's index and can't be used."],
		};
	}

	return {
		status: resolvedAll ? "ready" : status,
		segments: resolutions,
		folderPath,
		noteTitle,
		notePath: resolvedAll ? joinPath(folderPath, `${noteTitle}.md`) : "",
		titleSource,
		missingFolders,
		warnings,
	};
}
