import { SortPresentedEvent, SortPresentedPhase, SortResolvedEvent, SortResolvedOutcome, SortStatsEvent } from "./SortOutcome";

/**
 * Pure aggregation over a Sort stats event list -- no I/O, no Obsidian imports. Consumed by both
 * SortStatsStore's own callers (a future in-app summary, if ever added) and
 * scripts/sort-stats-dashboard.mjs's `/api/stats` endpoint (re-implemented there in plain JS
 * from a copy of this same logic, since the dashboard script runs standalone under plain Node
 * with no TypeScript build step -- see that script's header comment).
 *
 * Denominator choices not spelled out verbatim by the implementation brief are documented inline
 * at each metric as an explicit judgment call, not left implicit.
 */

export interface RateStat {
	numerator: number;
	denominator: number;
	/** null (not NaN/0) when the denominator is 0 -- "no data yet", distinct from "measured 0%". */
	rate: number | null;
}

function rateStat(numerator: number, denominator: number): RateStat {
	return { numerator, denominator, rate: denominator > 0 ? numerator / denominator : null };
}

function median(values: readonly number[]): number | null {
	if (values.length === 0) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Outcomes that represent the text actually being routed somewhere (as opposed to the user
 *  giving up) -- "successfully resolved" throughout this module means "outcome is one of these",
 *  matching the brief's "successfully resolved confident-match decisions" denominator language. */
const SUCCESS_OUTCOMES: ReadonlySet<SortResolvedOutcome> = new Set([
	"accepted-top",
	"selected-alternate",
	"manual-confirmed-top",
	"manual-selected-other",
	"created-note",
]);

const ALL_PHASES: readonly SortPresentedPhase[] = ["confident", "ambiguous", "low-confidence", "empty-index"];

export interface ThresholdObservation {
	minConfidence: number;
	minMargin: number;
	count: number;
	firstSeen: number;
	lastSeen: number;
}

export interface SortStatsAggregate {
	/** Total Sort presentations in the retained window, unfiltered (includes empty-index and
	 *  incomplete-index -- those are reported separately as diagnostics, see emptyIndexCount/
	 *  incompleteIndexCount, and excluded from the rate metrics below, not from this count). */
	sampleSize: number;
	resolvedSampleSize: number;
	firstTimestamp: number | null;
	lastTimestamp: number | null;

	/** Confident-match card direct accepts. Denominator: successfully resolved confident-phase
	 *  decisions (brief-specified). Excludes incomplete-index presentations (see below). */
	topAccepted: RateStat;
	/** Confident or ambiguous phase, successfully resolved somewhere other than the original top
	 *  result (non-top ambiguous pick, a different note via Search instead, or a new note).
	 *  Denominator (judgment call, not spelled out verbatim by the brief): successfully resolved
	 *  confident-or-ambiguous decisions -- the same "was an answer actually offered" scope as
	 *  Top accepted, extended to include ambiguous so "non-top ambiguous candidate" has a home. */
	reassigned: RateStat;
	/** Presentation-based, not action-based (brief: "measures how often Sort fell through before
	 *  the user acted"). Denominator: presented Sorts with at least one indexed candidate
	 *  (phase !== "empty-index"), excluding incomplete-index. */
	noConfidentMatch: RateStat;
	/** Same denominator basis as noConfidentMatch -- "evaluated Sorts" with at least one
	 *  candidate, excluding empty-index and incomplete-index. */
	ambiguousFrequency: RateStat;
	/** Low-confidence Sorts where the user found and appended to an existing note via Search
	 *  instead (either the same note the low-confidence card would have suggested, or a
	 *  different one -- both are "the note existed and was findable, MIN_CONFIDENCE just didn't
	 *  surface it automatically"). Denominator (judgment call): all low-confidence presentations,
	 *  matching noConfidentMatch's presentation-based framing. */
	lowConfidenceRescueRate: RateStat;
	/** Confident Sorts successfully resolved somewhere other than the top result, WITHOUT
	 *  counting a Search-instead reselection of that same top result (manual-confirmed-top) as
	 *  an override -- they still ended up at the top note, just via a more deliberate path.
	 *  Denominator: successfully resolved confident-phase decisions, same as topAccepted. */
	confidentOverrideRate: RateStat;

	/** New-note creation rate, broken down by the phase the Sort was originally presented in --
	 *  distinguishes "low-confidence result followed by creation" from "confident result
	 *  overridden with creation" etc. (brief "Successful create"). Denominator per phase: eligible
	 *  presentations in that phase. */
	createdNoteByPhase: Record<SortPresentedPhase, RateStat>;
	/** Keep editing or a draft edit after a decision was shown. Denominator: all presentations
	 *  (unfiltered by incomplete-index -- this is a UX-friction diagnostic, not a threshold-
	 *  analysis rate, so the brief's incomplete-index exclusion does not apply here). */
	dismissedRate: RateStat;
	/** Reported as a raw count, not a rate -- the brief explicitly keeps abandonment outside the
	 *  three primary rate denominators. */
	abandonedCount: number;

	/** Median milliseconds from presentation to resolution (any outcome, including dismissed/
	 *  abandoned), grouped by the phase the Sort was originally presented in. null when a phase
	 *  has no resolved samples yet. */
	medianDecisionMsByPhase: Record<SortPresentedPhase, number | null>;

	/** Data-quality diagnostics, excluded from every rate metric above. */
	emptyIndexCount: number;
	incompleteIndexCount: number;

	/** The most recently observed (minConfidence, minMargin) pair, plus the full distinct history
	 *  -- "Store each event's active threshold values so data remains interpretable after
	 *  constants change" (brief "Relationship to threshold tuning"). */
	currentThreshold: { minConfidence: number; minMargin: number } | null;
	observedThresholds: ThresholdObservation[];
}

export function computeSortStatsAggregate(events: readonly SortStatsEvent[]): SortStatsAggregate {
	const presented = events.filter((e): e is SortPresentedEvent => e.kind === "sort-presented");
	const resolved = events.filter((e): e is SortResolvedEvent => e.kind === "sort-resolved");
	const resolvedById = new Map(resolved.map((e) => [e.sortId, e] as const));

	const timestamps = events.map((e) => e.timestamp);
	const firstTimestamp = timestamps.length ? Math.min(...timestamps) : null;
	const lastTimestamp = timestamps.length ? Math.max(...timestamps) : null;

	const emptyIndexCount = presented.filter((p) => p.phase === "empty-index").length;
	const incompleteIndexCount = presented.filter((p) => p.indexWasBuilding).length;

	// Threshold-analysis rates exclude incomplete-index presentations by default (brief:
	// "excluded by default from threshold-analysis summaries").
	const eligible = presented.filter((p) => !p.indexWasBuilding);

	const successfulInPhases = (phases: readonly SortPresentedPhase[]): Array<{ presented: SortPresentedEvent; resolved: SortResolvedEvent }> =>
		eligible
			.filter((p) => phases.includes(p.phase))
			.map((p) => ({ presented: p, resolved: resolvedById.get(p.sortId) }))
			.filter((pair): pair is { presented: SortPresentedEvent; resolved: SortResolvedEvent } => !!pair.resolved && SUCCESS_OUTCOMES.has(pair.resolved.outcome));

	const confidentSuccess = successfulInPhases(["confident"]);
	const topAccepted = rateStat(
		confidentSuccess.filter((p) => p.resolved.outcome === "accepted-top").length,
		confidentSuccess.length,
	);
	const confidentOverrideRate = rateStat(
		confidentSuccess.filter((p) => p.resolved.outcome === "manual-selected-other" || p.resolved.outcome === "created-note").length,
		confidentSuccess.length,
	);

	const confidentOrAmbiguousSuccess = successfulInPhases(["confident", "ambiguous"]);
	const reassigned = rateStat(
		confidentOrAmbiguousSuccess.filter((p) => p.resolved.outcome !== "accepted-top" && p.resolved.outcome !== "manual-confirmed-top").length,
		confidentOrAmbiguousSuccess.length,
	);

	const evaluated = eligible.filter((p) => p.phase !== "empty-index");
	const noConfidentMatch = rateStat(evaluated.filter((p) => p.phase === "low-confidence").length, evaluated.length);
	const ambiguousFrequency = rateStat(evaluated.filter((p) => p.phase === "ambiguous").length, evaluated.length);

	const lowConfidencePresented = eligible.filter((p) => p.phase === "low-confidence");
	const lowConfidenceRescueRate = rateStat(
		lowConfidencePresented.filter((p) => {
			const r = resolvedById.get(p.sortId);
			return !!r && (r.outcome === "manual-confirmed-top" || r.outcome === "manual-selected-other");
		}).length,
		lowConfidencePresented.length,
	);

	const createdNoteByPhase = Object.fromEntries(
		ALL_PHASES.map((phase) => {
			const inPhase = eligible.filter((p) => p.phase === phase);
			const created = inPhase.filter((p) => resolvedById.get(p.sortId)?.outcome === "created-note").length;
			return [phase, rateStat(created, inPhase.length)];
		}),
	) as Record<SortPresentedPhase, RateStat>;

	const dismissedRate = rateStat(
		presented.filter((p) => resolvedById.get(p.sortId)?.outcome === "dismissed").length,
		presented.length,
	);
	const abandonedCount = presented.filter((p) => resolvedById.get(p.sortId)?.outcome === "abandoned").length;

	const medianDecisionMsByPhase = Object.fromEntries(
		ALL_PHASES.map((phase) => {
			const times = presented
				.filter((p) => p.phase === phase)
				.map((p) => resolvedById.get(p.sortId)?.decisionMs)
				.filter((ms): ms is number => typeof ms === "number");
			return [phase, median(times)];
		}),
	) as Record<SortPresentedPhase, number | null>;

	const thresholdMap = new Map<string, ThresholdObservation>();
	for (const p of presented) {
		const key = `${p.minConfidence}:${p.minMargin}`;
		const existing = thresholdMap.get(key);
		if (existing) {
			existing.count++;
			existing.firstSeen = Math.min(existing.firstSeen, p.timestamp);
			existing.lastSeen = Math.max(existing.lastSeen, p.timestamp);
		} else {
			thresholdMap.set(key, { minConfidence: p.minConfidence, minMargin: p.minMargin, count: 1, firstSeen: p.timestamp, lastSeen: p.timestamp });
		}
	}
	const observedThresholds = Array.from(thresholdMap.values()).sort((a, b) => b.lastSeen - a.lastSeen);
	const currentThreshold = observedThresholds[0]
		? { minConfidence: observedThresholds[0].minConfidence, minMargin: observedThresholds[0].minMargin }
		: null;

	return {
		sampleSize: presented.length,
		resolvedSampleSize: resolved.length,
		firstTimestamp,
		lastTimestamp,
		topAccepted,
		reassigned,
		noConfidentMatch,
		ambiguousFrequency,
		lowConfidenceRescueRate,
		confidentOverrideRate,
		createdNoteByPhase,
		dismissedRate,
		abandonedCount,
		medianDecisionMsByPhase,
		emptyIndexCount,
		incompleteIndexCount,
		currentThreshold,
		observedThresholds,
	};
}
