import { describe, expect, it } from "vitest";
import { classifyAddOutcome, classifyPresentedPhase, computeMargin, makeSortId } from "../../src/stats/SortOutcome";

const MIN_CONFIDENCE = 0.4;
const MIN_MARGIN = 0.05;

describe("classifyPresentedPhase", () => {
	it("classifies confident: a clear top score with enough margin", () => {
		const phase = classifyPresentedPhase([{ score: 0.8 }, { score: 0.5 }], 10, MIN_CONFIDENCE, MIN_MARGIN);
		expect(phase).toBe("confident");
	});

	it("classifies ambiguous: top score qualifies but the margin over #2 is too small", () => {
		const phase = classifyPresentedPhase([{ score: 0.8 }, { score: 0.78 }], 10, MIN_CONFIDENCE, MIN_MARGIN);
		expect(phase).toBe("ambiguous");
	});

	it("classifies low-confidence: top score below MIN_CONFIDENCE", () => {
		const phase = classifyPresentedPhase([{ score: 0.2 }], 10, MIN_CONFIDENCE, MIN_MARGIN);
		expect(phase).toBe("low-confidence");
	});

	it("classifies empty-index whenever indexedNoteCount is 0, regardless of results", () => {
		expect(classifyPresentedPhase([], 0, MIN_CONFIDENCE, MIN_MARGIN)).toBe("empty-index");
	});

	it("a confident top score with no second candidate is confident, not ambiguous (infinite-margin normalization)", () => {
		const phase = classifyPresentedPhase([{ score: 0.8 }], 1, MIN_CONFIDENCE, MIN_MARGIN);
		expect(phase).toBe("confident");
	});

	it("a low-confidence top score with no second candidate stays low-confidence, not ambiguous", () => {
		const phase = classifyPresentedPhase([{ score: 0.1 }], 1, MIN_CONFIDENCE, MIN_MARGIN);
		expect(phase).toBe("low-confidence");
	});
});

describe("computeMargin", () => {
	it("returns the gap between the top two scores", () => {
		expect(computeMargin([{ score: 0.8 }, { score: 0.5 }])).toBeCloseTo(0.3);
	});

	it("normalizes a missing second result to null, not Infinity", () => {
		expect(computeMargin([{ score: 0.8 }])).toBeNull();
	});

	it("normalizes an empty result list to null", () => {
		expect(computeMargin([])).toBeNull();
	});
});

describe("classifyAddOutcome", () => {
	it("confident-top always resolves as accepted-top", () => {
		const result = classifyAddOutcome({ kind: "confident-top" }, "notes/a.md", "notes/a.md");
		expect(result).toEqual({ outcome: "accepted-top" });
	});

	it("ambiguous-candidate rank 0 (the top candidate) resolves as accepted-top, distinguishable via rank", () => {
		const result = classifyAddOutcome({ kind: "ambiguous-candidate", rank: 0 }, "notes/a.md", "notes/a.md");
		expect(result).toEqual({ outcome: "accepted-top", selectedRank: 0 });
	});

	it("ambiguous-candidate rank > 0 resolves as selected-alternate with the correct rank", () => {
		const result = classifyAddOutcome({ kind: "ambiguous-candidate", rank: 2 }, "notes/c.md", "notes/a.md");
		expect(result).toEqual({ outcome: "selected-alternate", selectedRank: 2 });
	});

	it("manual-picker selecting the original top result resolves as manual-confirmed-top, not a direct accept", () => {
		const result = classifyAddOutcome({ kind: "manual-picker" }, "notes/a.md", "notes/a.md");
		expect(result).toEqual({ outcome: "manual-confirmed-top" });
	});

	it("manual-picker selecting a different note resolves as manual-selected-other (reassignment)", () => {
		const result = classifyAddOutcome({ kind: "manual-picker" }, "notes/b.md", "notes/a.md");
		expect(result).toEqual({ outcome: "manual-selected-other" });
	});

	it("manual-picker with no original top result (empty-index/low-confidence with no candidate) is manual-selected-other", () => {
		const result = classifyAddOutcome({ kind: "manual-picker" }, "notes/b.md", null);
		expect(result).toEqual({ outcome: "manual-selected-other" });
	});
});

describe("makeSortId", () => {
	it("produces distinct ids across successive calls", () => {
		const ids = new Set(Array.from({ length: 50 }, () => makeSortId()));
		expect(ids.size).toBe(50);
	});

	it("is a non-empty string", () => {
		expect(typeof makeSortId()).toBe("string");
		expect(makeSortId().length).toBeGreaterThan(0);
	});
});
