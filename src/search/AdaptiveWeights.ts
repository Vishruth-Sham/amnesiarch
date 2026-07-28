import { VaultProfile } from "../index/VaultProfiler";

/** Weights for HybridSearch's structural sub-score, normalized to sum to 1. */
export interface StructuralWeights {
	title: number;
	folder: number;
	tag: number;
}

export const EQUAL_WEIGHTS: StructuralWeights = { title: 1 / 3, folder: 1 / 3, tag: 1 / 3 };

/**
 * Redistribute the structural sub-score's internal weight toward whichever signals actually
 * carry information in this vault, instead of v1's flat Math.max(title, folder, tag*0.7) tuned
 * against one vault. See plans/v2-scale-first.md §2.5/§4 Phase 2.
 *
 * This is deliberately a simple, transparent formula (each input is already a 0..1 fraction
 * from VaultProfile) rather than a fitted model -- it's explicitly flagged in the plan as an
 * initial heuristic that needs tuning against a real multi-thousand-note vault, not something
 * to over-engineer against the ~500-note dev vault this was written in.
 *
 * Does NOT touch the outer (1 - STRUCTURAL_WEIGHT)*semantic + STRUCTURAL_WEIGHT*structural
 * split in HybridSearch.ts -- only how the structural budget is divided internally.
 */
export function deriveStructuralWeights(profile: VaultProfile): StructuralWeights {
	const titleSignal = profile.titleInformativeness;
	const folderSignal = profile.folderCoverage;
	const tagSignal = profile.tagCoverage;

	const total = titleSignal + folderSignal + tagSignal;
	if (total <= 0) return EQUAL_WEIGHTS; // no structural signal at all in this vault

	return {
		title: titleSignal / total,
		folder: folderSignal / total,
		tag: tagSignal / total,
	};
}
