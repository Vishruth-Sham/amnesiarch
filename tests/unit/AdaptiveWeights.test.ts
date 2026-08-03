import { describe, expect, it } from "vitest";
import { deriveStructuralWeights, EQUAL_WEIGHTS } from "../../src/search/AdaptiveWeights";
import { VaultProfile } from "../../src/index/VaultProfiler";

function profile(overrides: Partial<VaultProfile> = {}): VaultProfile {
	return {
		noteCount: 100,
		tagCoverage: 0,
		tagVocabRatio: 0,
		folderCoverage: 0,
		folderBranching: 0,
		linkDensity: 0,
		titleInformativeness: 0,
		schemaKeys: {},
		...overrides,
	};
}

describe("AdaptiveWeights.deriveStructuralWeights", () => {
	it("falls back to EQUAL_WEIGHTS when the vault has no structural signal at all", () => {
		const weights = deriveStructuralWeights(profile());
		expect(weights).toEqual(EQUAL_WEIGHTS);
	});

	it("always returns weights that sum to 1", () => {
		const weights = deriveStructuralWeights(profile({ titleInformativeness: 0.9, folderCoverage: 0.2, tagCoverage: 0.4 }));
		expect(weights.title + weights.folder + weights.tag).toBeCloseTo(1);
	});

	it("redistributes weight toward the dominant structural signal", () => {
		const weights = deriveStructuralWeights(profile({ titleInformativeness: 1, folderCoverage: 0, tagCoverage: 0 }));
		expect(weights.title).toBeCloseTo(1);
		expect(weights.folder).toBeCloseTo(0);
		expect(weights.tag).toBeCloseTo(0);
	});

	it("splits weight proportionally across all three signals", () => {
		const weights = deriveStructuralWeights(profile({ titleInformativeness: 0.5, folderCoverage: 0.25, tagCoverage: 0.25 }));
		expect(weights.title).toBeCloseTo(0.5);
		expect(weights.folder).toBeCloseTo(0.25);
		expect(weights.tag).toBeCloseTo(0.25);
	});
});
