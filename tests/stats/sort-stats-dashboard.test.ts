import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { createServer, loadStatsEvents, parseArgs, resolveStatsPath } from "../../scripts/sort-stats-dashboard.mjs";

const FIXTURE_EVENTS = [
	{
		schemaVersion: 1,
		kind: "sort-presented",
		sortId: "a",
		timestamp: 1000,
		phase: "confident",
		topScore: 0.8,
		secondScore: 0.5,
		margin: 0.3,
		returnedCandidateCount: 3,
		indexedNoteCount: 100,
		indexWasBuilding: false,
		minConfidence: 0.4,
		minMargin: 0.05,
	},
	{ schemaVersion: 1, kind: "sort-resolved", sortId: "a", timestamp: 2000, decisionMs: 1000, outcome: "accepted-top" },
	{
		schemaVersion: 1,
		kind: "sort-presented",
		sortId: "b",
		timestamp: 1500,
		phase: "low-confidence",
		topScore: 0.2,
		secondScore: null,
		margin: null,
		returnedCandidateCount: 1,
		indexedNoteCount: 100,
		indexWasBuilding: false,
		minConfidence: 0.4,
		minMargin: 0.05,
	},
	{ schemaVersion: 1, kind: "sort-resolved", sortId: "b", timestamp: 3000, decisionMs: 1500, outcome: "manual-selected-other" },
];

describe("sort-stats-dashboard argument/path resolution", () => {
	it("--stats-file takes precedence over --vault", () => {
		const path = resolveStatsPath({ vault: "/vault", statsFile: "/explicit/sort-stats.json" });
		expect(path).toBe("/explicit/sort-stats.json");
	});

	it("--vault resolves the standard plugin-directory location", () => {
		const path = resolveStatsPath({ vault: "/my/vault", statsFile: null });
		expect(path).toBe("/my/vault/.obsidian/plugins/amnesiarch/sort-stats.json");
	});

	it("throws a clear error when neither --vault nor --stats-file is given", () => {
		expect(() => resolveStatsPath({ vault: null, statsFile: null })).toThrow(/--vault|--stats-file/);
	});

	it("parseArgs defaults to opening the browser, --no-open disables it", () => {
		expect(parseArgs(["--vault", "/v"]).open).toBe(true);
		expect(parseArgs(["--vault", "/v", "--no-open"]).open).toBe(false);
	});
});

describe("loadStatsEvents", () => {
	let dir: string;

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "amnesiarch-stats-"));
	});

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it("fails with a useful message for a missing file", async () => {
		await expect(loadStatsEvents(join(dir, "sort-stats.json"))).rejects.toThrow(/No sort-stats\.json found/);
	});

	it("fails with a useful message for invalid JSON", async () => {
		const path = join(dir, "sort-stats.json");
		await writeFile(path, "{ not json");
		await expect(loadStatsEvents(path)).rejects.toThrow(/not valid JSON/);
	});

	it("fails with a useful message for an unsupported schema", async () => {
		const path = join(dir, "sort-stats.json");
		await writeFile(path, JSON.stringify({ version: 2, events: [] }));
		await expect(loadStatsEvents(path)).rejects.toThrow(/unsupported schema/);
	});

	it("returns the events array for a valid file", async () => {
		const path = join(dir, "sort-stats.json");
		await writeFile(path, JSON.stringify({ version: 1, events: FIXTURE_EVENTS }));
		await expect(loadStatsEvents(path)).resolves.toEqual(FIXTURE_EVENTS);
	});
});

describe("sort-stats-dashboard HTTP server", () => {
	let dir: string;
	let statsPath: string;
	let server: ReturnType<typeof createServer>;
	let baseUrl: string;

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "amnesiarch-stats-"));
		statsPath = join(dir, "sort-stats.json");
		await writeFile(statsPath, JSON.stringify({ version: 1, events: FIXTURE_EVENTS }));

		server = createServer(statsPath);
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		const address = server.address() as AddressInfo;
		baseUrl = `http://127.0.0.1:${address.port}`;
	});

	afterEach(async () => {
		await new Promise<void>((resolve) => server.close(() => resolve()));
		await rm(dir, { recursive: true, force: true });
	});

	it("binds to 127.0.0.1", () => {
		const address = server.address() as AddressInfo;
		expect(address.address).toBe("127.0.0.1");
	});

	it("GET / returns the dashboard page with no external asset references, and CSP + no-store headers", async () => {
		const res = await fetch(`${baseUrl}/`);
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type")).toContain("text/html");
		expect(res.headers.get("cache-control")).toBe("no-store");
		expect(res.headers.get("content-security-policy")).toContain("default-src 'self'");

		const html = await res.text();
		expect(html).not.toMatch(/https?:\/\//);
		expect(html).not.toMatch(/<link\s+[^>]*href=/i);
		expect(html).not.toMatch(/<script\s+[^>]*src=/i);
		expect(html).not.toMatch(/<img\s+[^>]*src=/i);
		// The absolute temp-dir fixture path must never appear in a browser-facing response.
		expect(html).not.toContain(dir);
	});

	it("GET /api/stats returns the aggregate for the fixture file, with no-store/CSP headers and no vault path", async () => {
		const res = await fetch(`${baseUrl}/api/stats`);
		expect(res.status).toBe(200);
		expect(res.headers.get("cache-control")).toBe("no-store");
		expect(res.headers.get("content-security-policy")).toContain("default-src 'self'");

		const body = await res.text();
		expect(body).not.toContain(dir);

		const data = JSON.parse(body);
		expect(data.sampleSize).toBe(2);
		expect(data.resolvedSampleSize).toBe(2);
		expect(data.topAccepted).toEqual({ numerator: 1, denominator: 1, rate: 1 });
	});

	it("unknown routes return 404", async () => {
		const res = await fetch(`${baseUrl}/nonexistent`);
		expect(res.status).toBe(404);
	});

	it("/api/stats surfaces a clear error (not a crash) when the underlying file becomes invalid", async () => {
		await writeFile(statsPath, "not json at all");
		const res = await fetch(`${baseUrl}/api/stats`);
		expect(res.status).toBe(500);
		const data = await res.json();
		expect(data.error).toMatch(/not valid JSON/);
	});
});
