import { describe, expect, it } from "vitest";
import { VaultIndexer } from "../../src/index/VaultIndexer";
import { NoteCache } from "../../src/index/NoteCache";
import { ProfileCache } from "../../src/search/ProfileCache";
import { search } from "../../src/search/HybridSearch";
import { fakeEmbed } from "../support/fakeEmbedder";
import { createFixtureApp } from "../support/testApp";

describe("HybridSearch end to end (dense fixture vault, fake embedder)", () => {
	async function indexFixture() {
		const { app, fixture } = createFixtureApp();
		const cache = new NoteCache(app, ".obsidian/plugins/amnesiarch");
		const indexer = new VaultIndexer(app, cache);
		await indexer.initialize();
		const profileCache = new ProfileCache(cache);
		return { cache, profileCache, fixture };
	}

	it("ranks a topic cluster's own notes above unrelated notes for a same-topic query", async () => {
		const { cache, profileCache, fixture } = await indexFixture();
		const sourdough = fixture.meta.clusters.find((c) => c.name === "sourdough")!;
		const marathon = fixture.meta.clusters.find((c) => c.name === "marathon-training")!;

		const query = "sourdough starter hydration fermentation bulk dough";
		const queryVec = fakeEmbed(query);
		const results = search(queryVec, query, cache.getAll(), profileCache.getWeights(), 10);

		const resultPaths = results.map((r) => r.entry.path);
		const sourdoughHits = resultPaths.filter((p) => sourdough.notePaths.includes(p)).length;
		const marathonHits = resultPaths.filter((p) => marathon.notePaths.includes(p)).length;

		expect(sourdoughHits).toBeGreaterThan(0);
		expect(sourdoughHits).toBeGreaterThan(marathonHits);
		// The single top hit should be a sourdough note, not a note from an unrelated cluster.
		expect(sourdough.notePaths).toContain(results[0].entry.path);
	}, 30000);

	it("ranks a different topic cluster's notes on top for its own distinct query", async () => {
		const { cache, profileCache, fixture } = await indexFixture();
		const typescript = fixture.meta.clusters.find((c) => c.name === "typescript-generics")!;

		const query = "generic type parameter constraint conditional mapped utility";
		const queryVec = fakeEmbed(query);
		const results = search(queryVec, query, cache.getAll(), profileCache.getWeights(), 10);

		expect(typescript.notePaths).toContain(results[0].entry.path);
	}, 30000);

	it("gives a structural (tag) boost when the query text names a cluster's tag verbatim", async () => {
		const { cache, profileCache, fixture } = await indexFixture();
		const japanese = fixture.meta.clusters.find((c) => c.name === "japanese-grammar")!;

		// A query with weak/no topical vocabulary overlap but that names the tag verbatim should
		// still surface at least one tagged note near the top via the structural sub-score.
		const query = "japanese notes";
		const queryVec = fakeEmbed(query);
		const results = search(queryVec, query, cache.getAll(), profileCache.getWeights(), 5);

		expect(results.some((r) => japanese.notePaths.includes(r.entry.path))).toBe(true);
	}, 30000);

	it("never returns more than topK results and stays sorted descending", async () => {
		const { cache, profileCache } = await indexFixture();
		const query = "composting carbon nitrogen microbes pile";
		const queryVec = fakeEmbed(query);
		const results = search(queryVec, query, cache.getAll(), profileCache.getWeights(), 5);
		expect(results.length).toBeLessThanOrEqual(5);
		for (let i = 1; i < results.length; i++) {
			expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
		}
	}, 30000);
});
