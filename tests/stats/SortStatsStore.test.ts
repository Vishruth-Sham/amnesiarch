import { afterEach, describe, expect, it, vi } from "vitest";
import { SortStatsStore } from "../../src/stats/SortStatsStore";
import { SortPresentedEvent, SortResolvedEvent } from "../../src/stats/SortOutcome";
import { createEmptyApp } from "../support/testApp";
import { STATS_RETENTION_LIMIT, STATS_SAVE_DEBOUNCE_MS } from "../../src/constants";

const PLUGIN_DIR = ".obsidian/plugins/amnesiarch";

function presentedEvent(sortId: string, timestamp = 0): SortPresentedEvent {
	return {
		schemaVersion: 1,
		kind: "sort-presented",
		sortId,
		timestamp,
		phase: "confident",
		topScore: 0.8,
		secondScore: 0.5,
		margin: 0.3,
		returnedCandidateCount: 1,
		indexedNoteCount: 10,
		indexWasBuilding: false,
		minConfidence: 0.4,
		minMargin: 0.05,
	};
}

function resolvedEvent(sortId: string, timestamp = 100): SortResolvedEvent {
	return {
		schemaVersion: 1,
		kind: "sort-resolved",
		sortId,
		timestamp,
		decisionMs: timestamp,
		outcome: "accepted-top",
	};
}

describe("SortStatsStore", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("load() on a vault with no stats file yet leaves the store empty (no throw)", async () => {
		const { app } = createEmptyApp();
		const store = new SortStatsStore(app, PLUGIN_DIR, () => true);
		await expect(store.load()).resolves.toBeUndefined();
		expect(store.getEvents()).toEqual([]);
	});

	it("a valid file round-trips through flush() and load()", async () => {
		const { app } = createEmptyApp();
		const store = new SortStatsStore(app, PLUGIN_DIR, () => true);
		store.recordPresented(presentedEvent("a"));
		store.recordResolved(resolvedEvent("a"));
		await store.flush();

		const reloaded = new SortStatsStore(app, PLUGIN_DIR, () => true);
		await reloaded.load();
		expect(reloaded.getEvents()).toHaveLength(2);
		expect(reloaded.getEvents().map((e) => e.kind)).toEqual(["sort-presented", "sort-resolved"]);
	});

	it("rapid presented+resolved events are coalesced into a single debounced write", async () => {
		const { app, mockApp } = createEmptyApp();
		const store = new SortStatsStore(app, PLUGIN_DIR, () => true);
		const writeSpy = vi.spyOn(mockApp.vault.adapter, "write");

		vi.useFakeTimers();
		store.recordPresented(presentedEvent("a"));
		store.recordResolved(resolvedEvent("a"));
		await vi.advanceTimersByTimeAsync(STATS_SAVE_DEBOUNCE_MS + 50);

		expect(writeSpy).toHaveBeenCalledTimes(1);
	});

	it("flush() bypasses the debounce and persists pending data immediately", async () => {
		const { app, mockApp } = createEmptyApp();
		const store = new SortStatsStore(app, PLUGIN_DIR, () => true);
		const writeSpy = vi.spyOn(mockApp.vault.adapter, "write");

		vi.useFakeTimers();
		store.recordPresented(presentedEvent("a"));
		await store.flush();
		expect(writeSpy).toHaveBeenCalledTimes(1);

		await vi.advanceTimersByTimeAsync(STATS_SAVE_DEBOUNCE_MS + 50);
		expect(writeSpy).toHaveBeenCalledTimes(1); // the debounce timer was cancelled, not just pre-empted
	});

	it("retention prunes complete presentation+resolution pairs, keeping only the latest STATS_RETENTION_LIMIT", async () => {
		const { app } = createEmptyApp();
		const store = new SortStatsStore(app, PLUGIN_DIR, () => true);

		const total = STATS_RETENTION_LIMIT + 10;
		for (let i = 0; i < total; i++) {
			store.recordPresented(presentedEvent(`s${i}`, i));
			store.recordResolved(resolvedEvent(`s${i}`, i + 1));
		}
		await store.flush();

		const events = store.getEvents();
		const presentedIds = events.filter((e) => e.kind === "sort-presented").map((e) => e.sortId);
		expect(presentedIds).toHaveLength(STATS_RETENTION_LIMIT);
		// The oldest presentations should have aged out, the newest retained.
		expect(presentedIds).not.toContain("s0");
		expect(presentedIds).toContain(`s${total - 1}`);

		// Every retained presentation still has its matching resolution (pairs kept together).
		const resolvedIds = new Set(events.filter((e) => e.kind === "sort-resolved").map((e) => e.sortId));
		for (const id of presentedIds) expect(resolvedIds.has(id)).toBe(true);
	});

	it("an unsupported schema version is rejected safely, backed up, and starts a fresh empty store", async () => {
		const { app, mockApp } = createEmptyApp();
		const original = JSON.stringify({ version: 999, events: [presentedEvent("old")] });
		await app.vault.adapter.write(`${PLUGIN_DIR}/sort-stats.json`, original);
		const writeSpy = vi.spyOn(mockApp.vault.adapter, "write");

		const store = new SortStatsStore(app, PLUGIN_DIR, () => true);
		await expect(store.load()).resolves.toBeUndefined();
		expect(store.getEvents()).toEqual([]);

		// A timestamped backup of the unsupported file's exact original content was preserved.
		const backupCall = writeSpy.mock.calls.find(([path]) => /sort-stats\.corrupt\.\d+\.json$/.test(path as string));
		expect(backupCall).toBeDefined();
		expect(backupCall?.[1]).toBe(original);
	});

	it("corrupt (non-JSON) content is preserved as a backup and reported, without throwing", async () => {
		const { app, mockApp } = createEmptyApp();
		const original = "{ not valid json";
		await app.vault.adapter.write(`${PLUGIN_DIR}/sort-stats.json`, original);
		const writeSpy = vi.spyOn(mockApp.vault.adapter, "write");

		const store = new SortStatsStore(app, PLUGIN_DIR, () => true);
		await expect(store.load()).resolves.toBeUndefined();
		expect(store.getEvents()).toEqual([]);

		const backupCall = writeSpy.mock.calls.find(([path]) => /sort-stats\.corrupt\.\d+\.json$/.test(path as string));
		expect(backupCall).toBeDefined();
		expect(backupCall?.[1]).toBe(original);
	});

	it("disabled collection performs no writes and records no events", async () => {
		const { app, mockApp } = createEmptyApp();
		const store = new SortStatsStore(app, PLUGIN_DIR, () => false);
		const writeSpy = vi.spyOn(mockApp.vault.adapter, "write");

		store.recordPresented(presentedEvent("a"));
		store.recordResolved(resolvedEvent("a"));

		// Not flush()ing here deliberately -- flush() always persists whatever is in memory
		// (correctly empty in this case) regardless of the enabled setting, since main.ts's
		// unload-time flush must still run even if collection was toggled off mid-session. The
		// thing actually under test is that recordPresented()/recordResolved() themselves never
		// touch the event list or schedule a write while disabled.
		expect(store.getEvents()).toEqual([]);
		expect(writeSpy).not.toHaveBeenCalled();
	});

	it("a duplicate resolution for the same sortId is ignored rather than double-recorded", async () => {
		const { app } = createEmptyApp();
		const store = new SortStatsStore(app, PLUGIN_DIR, () => true);

		store.recordPresented(presentedEvent("a"));
		store.recordResolved(resolvedEvent("a"));
		store.recordResolved(resolvedEvent("a")); // duplicate finalization attempt

		const resolvedCount = store.getEvents().filter((e) => e.kind === "sort-resolved").length;
		expect(resolvedCount).toBe(1);
	});

	it("reset() clears both memory and disk, regardless of the enabled setting", async () => {
		const { app } = createEmptyApp();
		const store = new SortStatsStore(app, PLUGIN_DIR, () => true);
		store.recordPresented(presentedEvent("a"));
		store.recordResolved(resolvedEvent("a"));
		await store.flush();
		expect(store.getEvents()).toHaveLength(2);

		await store.reset();
		expect(store.getEvents()).toEqual([]);

		const reloaded = new SortStatsStore(app, PLUGIN_DIR, () => true);
		await reloaded.load();
		expect(reloaded.getEvents()).toEqual([]);
	});
});
