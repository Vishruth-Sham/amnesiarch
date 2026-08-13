import { describe, expect, it } from "vitest";
import { computeSortStatsAggregate as computeTs } from "../../src/stats/SortStatsAggregation";
import { computeSortStatsAggregate as computeJs } from "../../scripts/lib/sort-stats-aggregate.mjs";
import { SortPresentedEvent, SortResolvedEvent, SortStatsEvent } from "../../src/stats/SortOutcome";

/**
 * scripts/lib/sort-stats-aggregate.mjs is a deliberate plain-JS duplicate of
 * src/stats/SortStatsAggregation.ts (see that file's header comment for why the dashboard can't
 * just import the TS module directly). This test is what keeps the two from silently drifting
 * apart: the same fixtures run through both implementations must produce identical output.
 */

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

function resolved(sortId: string, outcome: SortResolvedEvent["outcome"], overrides: Partial<SortResolvedEvent> = {}): SortResolvedEvent {
	return { schemaVersion: 1, kind: "sort-resolved", sortId, timestamp: 100, decisionMs: 100, outcome, ...overrides };
}

describe("TS/JS aggregate parity", () => {
	it("produces identical output for an empty event list", () => {
		expect(computeJs([])).toEqual(computeTs([]));
	});

	it("produces identical output across a mixed, multi-phase fixture", () => {
		const events: SortStatsEvent[] = [
			presented("a", { phase: "confident" }),
			resolved("a", "accepted-top"),
			presented("b", { phase: "confident" }),
			resolved("b", "manual-confirmed-top"),
			presented("c", { phase: "confident" }),
			resolved("c", "manual-selected-other"),
			presented("d", { phase: "ambiguous" }),
			resolved("d", "accepted-top", { selectedRank: 0 }),
			presented("e", { phase: "ambiguous" }),
			resolved("e", "selected-alternate", { selectedRank: 1 }),
			presented("f", { phase: "low-confidence" }),
			resolved("f", "manual-confirmed-top"),
			presented("g", { phase: "low-confidence" }),
			resolved("g", "created-note"),
			presented("h", { phase: "low-confidence" }),
			presented("i", { phase: "empty-index", indexedNoteCount: 0 }),
			resolved("i", "created-note"),
			presented("j", { phase: "confident", indexWasBuilding: true }),
			resolved("j", "accepted-top"),
			presented("k", { phase: "confident" }),
			resolved("k", "dismissed", { dismissalReason: "keep-editing" }),
			presented("l", { phase: "confident" }),
			resolved("l", "abandoned", { dismissalReason: "view-closed" }),
			presented("m", { phase: "confident", minConfidence: 0.5, minMargin: 0.1, timestamp: 5000 }),
		];

		expect(computeJs(events)).toEqual(computeTs(events));
	});
});
