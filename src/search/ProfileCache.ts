import { NoteCache } from "../index/NoteCache";
import { computeVaultProfile, VaultProfile } from "../index/VaultProfiler";
import { deriveStructuralWeights, EQUAL_WEIGHTS, StructuralWeights } from "./AdaptiveWeights";

/**
 * Lazily (re)computes the vault profile and derived structural weights, keyed off
 * NoteCache.generation so it only redoes the O(notes) pass when the cache has actually
 * changed -- not on every keystroke/search call. Deliberately not wired through
 * VaultIndexer's onIndexingComplete callback: that's a single function-property slot ChatView
 * already claims for its badge, and turning it into a proper multi-listener event just to hang
 * this off it would be a bigger change than a plain cache-with-a-version-check needs to be.
 */
export class ProfileCache {
	private lastGeneration = -1;
	private profile: VaultProfile | null = null;
	private weights: StructuralWeights = EQUAL_WEIGHTS;

	constructor(private cache: NoteCache) {}

	getWeights(): StructuralWeights {
		this.refreshIfStale();
		return this.weights;
	}

	getProfile(): VaultProfile | null {
		this.refreshIfStale();
		return this.profile;
	}

	private refreshIfStale(): void {
		if (this.cache.generation === this.lastGeneration) return;
		this.lastGeneration = this.cache.generation;
		this.profile = computeVaultProfile(this.cache.getAll());
		this.weights = deriveStructuralWeights(this.profile);
	}
}
