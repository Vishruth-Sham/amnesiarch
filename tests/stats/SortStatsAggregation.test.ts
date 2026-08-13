import { describe, expect, it } from "vitest";
import { computeSortStatsAggregate } from "../../src/stats/SortStatsAggregation";
import { SortPresentedEvent, SortPresentedPhase, SortResolvedEvent, SortResolvedOutcome, SortStatsEvent } from "../../src/stats/SortOutcome";

function presented(sortId: string, overrides: Partial<SortPresentedEvent> = {}): SortPresentedEvent {
	return {
		schemaVersion: 1,
		kind: "sort-presented",
		sortId,
		timestamp: 0,
		phase: "confident",
		topScore: 0.8,
		secondScore: 0.5,
		margin: 0.3,
		returnedCandidateCount: 1,
		indexedNoteCount: 10,
		indexWasBuilding: false,
		minConfidence: 0.4,
		minMargin: 0.05,
		...overrides,
	};
}

function resolved(sortId: string, outcome: SortResolvedOutcome, overrides: Partial<SortResolvedEvent> = {}): SortResolvedEvent {
	return {
		schemaVersion: 1,
		kind: "sort-resolved",
		sortId,
		timestamp: 100,
		decisionMs: 100,
		outcome,
		...overrides,
	};
}

describe("computeSortStatsAggregate", () => {
	it("returns null rates and zero counts for an empty event list", () => {
		const agg = computeSortStatsAggregate([]);
		expect(agg.sampleSize).toBe(0);
		expect(agg.resolvedSampleSize).toBe(0);
		expect(agg.topAccepted).toEqual({ numerator: 0, denominator: 0, rate: null });
		expect(agg.currentThreshold).toBeNull();
		expect(agg.observedThresholds).toEqual([]);
		expect(agg.firstTimestamp).toBeNull();
		expect(agg.lastTimestamp).toBeNull();
	});

	it("keeps exposure (presented) counts distinct from resolved-decision counts", () => {
		const events: SortStatsEvent[] = [presented("a"), presented("b"), presented("c"), resolved("a", "accepted-top"), resolved("b", "dismissed")];
		const agg = computeSortStatsAggregate(events);
		expect(agg.sampleSize).toBe(3);
		expect(agg.resolvedSampleSize).toBe(2);
	});

	it("Top accepted: numerator is accepted-top, denominator is every successfully-resolved confident decision (manual-confirmed-top included in the denominator but not the numerator)", () => {
		const events: SortStatsEvent[] = [
			presented("a", { phase: "confident" }),
			resolved("a", "accepted-top"),
			presented("b", { phase: "confident" }),
			resolved("b", "manual-confirmed-top"),
			presented("c", { phase: "confident" }),
			// unresolved -- must not appear in either numerator or denominator
		];
		const agg = computeSortStatsAggregate(events);
		expect(agg.topAccepted).toEqual({ numerator: 1, denominator: 2, rate: 0.5 });
	});

	it("Reassigned: non-top ambiguous pick, a different note via Search instead, and creation after confident/ambiguous all count; manual-confirmed-top and accepted-top do not", () => {
		const events: SortStatsEvent[] = [
			presented("top", { phase: "confident" }),
			resolved("top", "accepted-top"),
			presented("confirmed", { phase: "confident" }),
			resolved("confirmed", "manual-confirmed-top"),
			presented("alt", { phase: "ambiguous" }),
			resolved("alt", "selected-alternate", { selectedRank: 1 }),
			presented("other", { phase: "confident" }),
			resolved("other", "manual-selected-other"),
			presented("created", { phase: "ambiguous" }),
			resolved("created", "created-note"),
		];
		const agg = computeSortStatsAggregate(events);
		// denominator: every successfully resolved confident-or-ambiguous decision (5)
		// numerator: alt, other, created (3)
		expect(agg.reassigned).toEqual({ numerator: 3, denominator: 5, rate: 0.6 });
	});

	it("No confident match and Ambiguous-state frequency are presentation-based and exclude empty-index from the denominator", () => {
		const events: SortStatsEvent[] = [
			presented("c1", { phase: "confident" }),
			presented("c2", { phase: "confident" }),
			presented("amb", { phase: "ambiguous" }),
			presented("lc", { phase: "low-confidence" }),
			presented("empty", { phase: "empty-index", indexedNoteCount: 0 }),
		];
		const agg = computeSortStatsAggregate(events);
		// denominator: 4 (empty-index excluded)
		expect(agg.noConfidentMatch).toEqual({ numerator: 1, denominator: 4, rate: 0.25 });
		expect(agg.ambiguousFrequency).toEqual({ numerator: 1, denominator: 4, rate: 0.25 });
		expect(agg.emptyIndexCount).toBe(1);
	});

	it("Low-confidence rescue rate counts a Search-instead append (either the same or a different note) against all low-confidence presentations", () => {
		const events: SortStatsEvent[] = [
			presented("rescued-same", { phase: "low-confidence" }),
			resolved("rescued-same", "manual-confirmed-top"),
			presented("rescued-other", { phase: "low-confidence" }),
			resolved("rescued-other", "manual-selected-other"),
			presented("dismissed", { phase: "low-confidence" }),
			resolved("dismissed", "dismissed", { dismissalReason: "keep-editing" }),
			presented("unresolved", { phase: "low-confidence" }),
		];
		const agg = computeSortStatsAggregate(events);
		expect(agg.lowConfidenceRescueRate).toEqual({ numerator: 2, denominator: 4, rate: 0.5 });
	});

	it("Confident override rate counts manual-selected-other and created-note, not manual-confirmed-top or accepted-top", () => {
		const events: SortStatsEvent[] = [
			presented("a", { phase: "confident" }),
			resolved("a", "accepted-top"),
			presented("b", { phase: "confident" }),
			resolved("b", "manual-confirmed-top"),
			presented("c", { phase: "confident" }),
			resolved("c", "manual-selected-other"),
			presented("d", { phase: "confident" }),
			resolved("d", "created-note"),
		];
		const agg = computeSortStatsAggregate(events);
		expect(agg.confidentOverrideRate).toEqual({ numerator: 2, denominator: 4, rate: 0.5 });
	});

	it("Created-note rate is broken down by the original presentation phase", () => {
		const phases: SortPresentedPhase[] = ["confident", "ambiguous", "low-confidence", "empty-index"];
		const events: SortStatsEvent[] = phases.flatMap((phase, i) => [
			presented(`created-${i}`, { phase, indexedNoteCount: phase === "empty-index" ? 0 : 10 }),
			resolved(`created-${i}`, "created-note"),
		]);
		const agg = computeSortStatsAggregate(events);
		for (const phase of phases) {
			expect(agg.createdNoteByPhase[phase]).toEqual({ numerator: 1, denominator: 1, rate: 1 });
		}
	});

	it("Dismissed rate is measured against all presentations, and abandoned is reported as a raw count outside every rate", () => {
		const events: SortStatsEvent[] = [
			presented("a"),
			resolved("a", "dismissed", { dismissalReason: "keep-editing" }),
			presented("b"),
			resolved("b", "dismissed", { dismissalReason: "draft-edited" }),
			presented("c"),
			resolved("c", "abandoned", { dismissalReason: "view-closed" }),
			presented("d"),
			resolved("d", "accepted-top"),
		];
		const agg = computeSortStatsAggregate(events);
		expect(agg.dismissedRate).toEqual({ numerator: 2, denominator: 4, rate: 0.5 });
		expect(agg.abandonedCount).toBe(1);
	});

	it("Median decision time is grouped by original phase, handling both odd and even sample counts, and null for a phase with no resolutions", () => {
		const events: SortStatsEvent[] = [
			presented("a", { phase: "confident" }),
			resolved("a", "accepted-top", { decisionMs: 100 }),
			presented("b", { phase: "confident" }),
			resolved("b", "accepted-top", { decisionMs: 300 }),
			presented("c", { phase: "confident" }),
			resolved("c", "accepted-top", { decisionMs: 200 }),
			presented("d", { phase: "ambiguous" }),
			resolved("d", "accepted-top", { decisionMs: 50, selectedRank: 0 }),
			presented("e", { phase: "ambiguous" }),
			resolved("e", "selected-alternate", { decisionMs: 150, selectedRank: 1 }),
		];
		const agg = computeSortStatsAggregate(events);
		expect(agg.medianDecisionMsByPhase.confident).toBe(200); // odd count -> middle value
		expect(agg.medianDecisionMsByPhase.ambiguous).toBe(100); // even count -> average of middle two
		expect(agg.medianDecisionMsByPhase["low-confidence"]).toBeNull();
	});

	it("Incomplete-index presentations are excluded from every threshold-analysis rate but still counted in incompleteIndexCount and sampleSize", () => {
		const events: SortStatsEvent[] = [
			presented("building", { phase: "confident", indexWasBuilding: true }),
			resolved("building", "accepted-top"),
			presented("ready", { phase: "confident", indexWasBuilding: false }),
			resolved("ready", "accepted-top"),
		];
		const agg = computeSortStatsAggregate(events);
		expect(agg.sampleSize).toBe(2);
		expect(agg.incompleteIndexCount).toBe(1);
		// Only the non-building presentation contributes to the rate.
		expect(agg.topAccepted).toEqual({ numerator: 1, denominator: 1, rate: 1 });
	});

	it("Observed thresholds are grouped by (minConfidence, minMargin), and currentThreshold is the most recently observed pair", () => {
		const events: SortStatsEvent[] = [
			presented("a", { timestamp: 1000, minConfidence: 0.4, minMargin: 0.05 }),
			presented("b", { timestamp: 2000, minConfidence: 0.4, minMargin: 0.05 }),
			presented("c", { timestamp: 3000, minConfidence: 0.5, minMargin: 0.1 }),
		];
		const agg = computeSortStatsAggregate(events);
		expect(agg.currentThreshold).toEqual({ minConfidence: 0.5, minMargin: 0.1 });
		expect(agg.observedThresholds).toHaveLength(2);
		const original = agg.observedThresholds.find((t) => t.minConfidence === 0.4);
		expect(original?.count).toBe(2);
	});
});
