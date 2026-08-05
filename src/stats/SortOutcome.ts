/**
 * Local Sort outcome statistics -- pure types and classification functions.
 *
 * See research/implementation-handoffs/quick-capture-local-sort-usage-stats.md for the full
 * design. This module contains no I/O and no Obsidian imports (deliberately, for testability
 * and to keep the privacy boundary auditable in one place): every field on every event here is
 * a categorical outcome, rank, numeric score, timestamp, or count. Nothing here is, or can
 * become, a note path, title, folder name, tag, search query, or content excerpt.
 *
 * "Top accepted" (not "correct rate"): accepting a suggestion is behavioral evidence it was
 * useful, not proof it was semantically correct. See the implementation brief's "Important
 * terminology" section -- this product is deliberately careful not to overclaim confidence.
 */

/** The decision state a Sort card was actually presented in. Distinct from the view's own
 *  `Phase` type (QuickCaptureView.ts) -- that type exists to pick which card to render, while
 *  this one exists to be logged; `classifyPresentedPhase()` below computes it independently, so
 *  no change is ever needed to the view's own `computePhase()`. */
export type SortPresentedPhase = "confident" | "ambiguous" | "low-confidence" | "empty-index";

export interface SortPresentedEvent {
	schemaVersion: 1;
	kind: "sort-presented";
	sortId: string;
	timestamp: number;

	phase: SortPresentedPhase;

	topScore: number | null;
	secondScore: number | null;
	margin: number | null;

	returnedCandidateCount: number;
	indexedNoteCount: number;
	indexWasBuilding: boolean;

	minConfidence: number;
	minMargin: number;
}

export type SortResolvedOutcome =
	| "accepted-top"
	| "selected-alternate"
	| "manual-confirmed-top"
	| "manual-selected-other"
	| "created-note"
	| "dismissed"
	| "abandoned";

export type SortDismissalReason = "keep-editing" | "draft-edited" | "view-closed";

export interface SortResolvedEvent {
	schemaVersion: 1;
	kind: "sort-resolved";
	sortId: string;
	timestamp: number;
	decisionMs: number;

	outcome: SortResolvedOutcome;

	selectedRank?: number;
	dismissalReason?: SortDismissalReason;
}

export type SortStatsEvent = SortPresentedEvent | SortResolvedEvent;

export interface SortStatsFile {
	version: 1;
	events: SortStatsEvent[];
}

/** How a successful `handleAdd()` append was attributed -- passed in explicitly by
 *  QuickCaptureView's call sites rather than inferred from mutable UI fields (implementation
 *  brief "Successful append"), so a later refactor of the card-rendering code can't silently
 *  change what gets recorded. */
export type AddOutcomeSource = { kind: "confident-top" } | { kind: "ambiguous-candidate"; rank: number } | { kind: "manual-picker" };

/** The view-local, in-memory-only record of a Sort awaiting resolution. Never persisted as-is
 *  (`topResultPath` is a real vault path) -- only ever consumed to compute the *categorical*
 *  outcome of the eventual resolution, which is what actually gets written to disk. */
export interface PendingSortObservation {
	sortId: string;
	presentedAt: number;
	phase: SortPresentedPhase;
	/** Top result's path at presentation time, or null when there was no top result
	 *  (empty-index). Used only for in-memory equality checks against the path the user actually
	 *  selects -- never written to the stats file. */
	topResultPath: string | null;
}

let sortIdCounter = 0;

/** A local join key, not a globally-unique identifier -- it only ever needs to disambiguate
 *  events within one local sort-stats.json, so a timestamp plus a process-local counter and a
 *  short random suffix is sufficient without adding a UUID dependency. */
export function makeSortId(now: number = Date.now()): string {
	sortIdCounter = (sortIdCounter + 1) % 1_000_000;
	const rand = Math.random().toString(36).slice(2, 8);
	return `${now.toString(36)}-${sortIdCounter.toString(36)}-${rand}`;
}

/** Margin between the top two candidate scores, normalized to `null` (not `Infinity`) when
 *  there is no second candidate to compare against -- an explicit, typed "not applicable"
 *  rather than relying on `JSON.stringify(Infinity)` happening to serialize as `null`. */
export function computeMargin(results: readonly { score: number }[]): number | null {
	const top = results[0];
	const second = results[1];
	if (!top || !second) return null;
	return top.score - second.score;
}

/**
 * Independently reproduces the same phase decision QuickCaptureView.computePhase() (plus its
 * caller's `results.length === 0` empty-index fold-in) makes for rendering, so that recording a
 * presentation event can never itself change `computePhase()` or its call sites (implementation
 * brief: "No change is permitted to computePhase() behavior"). `indexedNoteCount` -- not
 * `results.length` -- is the empty-index check: HybridSearch.search() always returns
 * `min(topK, entries.length)` results, so the two are equivalent, but `indexedNoteCount` is the
 * field actually persisted on the event and is the more direct signal.
 */
export function classifyPresentedPhase(
	results: readonly { score: number }[],
	indexedNoteCount: number,
	minConfidence: number,
	minMargin: number,
): SortPresentedPhase {
	if (indexedNoteCount === 0) return "empty-index";
	const top = results[0];
	if (!top || top.score < minConfidence) return "low-confidence";
	const second = results[1];
	if (second && top.score - second.score < minMargin) return "ambiguous";
	return "confident";
}

/**
 * Converts an append's attribution source plus a same-selection/different-selection comparison
 * (paths compared in memory only -- never persisted, see PendingSortObservation) into the
 * categorical resolution outcome. Selecting the original top result through "Search instead" is
 * `manual-confirmed-top`, deliberately distinct from both `accepted-top` (direct acceptance from
 * the decision card itself) and `selected-alternate`/`manual-selected-other` (reassignment) --
 * see the brief's "Important terminology" section.
 */
export function classifyAddOutcome(
	source: AddOutcomeSource,
	selectedPath: string,
	topResultPath: string | null,
): { outcome: SortResolvedOutcome; selectedRank?: number } {
	switch (source.kind) {
		case "confident-top":
			return { outcome: "accepted-top" };
		case "ambiguous-candidate":
			return source.rank === 0 ? { outcome: "accepted-top", selectedRank: 0 } : { outcome: "selected-alternate", selectedRank: source.rank };
		case "manual-picker":
			return selectedPath === topResultPath ? { outcome: "manual-confirmed-top" } : { outcome: "manual-selected-other" };
	}
}
