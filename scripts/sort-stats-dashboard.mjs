#!/usr/bin/env node
/**
 * Developer-only local dashboard for Amnesiarch's local Sort outcome statistics
 * (sort-stats.json). Node built-ins only -- no Express, no charting library, no frontend
 * framework, no analytics dependency (see research/implementation-handoffs/
 * quick-capture-local-sort-usage-stats.md's "Local dashboard" section). The Obsidian plugin
 * itself never starts a server; this script is the only thing that does, and only when a
 * developer explicitly runs `npm run stats`.
 *
 * Usage:
 *   npm run stats -- --vault "/absolute/path/to/vault"
 *   npm run stats -- --stats-file "/absolute/path/to/sort-stats.json"
 *   npm run stats -- --vault "..." --port 4200 --no-open
 *
 * --stats-file takes precedence over --vault when both are given.
 */

import { createServer as createHttpServer } from "node:http";
import { readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { spawn } from "node:child_process";
import { computeSortStatsAggregate } from "./lib/sort-stats-aggregate.mjs";

export const STATS_SCHEMA_VERSION = 1;
export const DEFAULT_PORT = 4176;
const PLUGIN_RELATIVE_PATH = ".obsidian/plugins/amnesiarch/sort-stats.json";

// ---------------------------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------------------------

export function parseArgs(argv) {
	const args = { vault: null, statsFile: null, port: DEFAULT_PORT, open: true };
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--vault") args.vault = argv[++i] ?? null;
		else if (arg === "--stats-file") args.statsFile = argv[++i] ?? null;
		else if (arg === "--port") args.port = Number(argv[++i]);
		else if (arg === "--open") args.open = true;
		else if (arg === "--no-open") args.open = false;
	}
	return args;
}

/** Resolves the effective sort-stats.json path from parsed args. `--stats-file` takes
 *  precedence over `--vault` (brief: "--stats-file takes precedence over --vault"). Throws a
 *  plain Error with a terminal-friendly message when neither is usable -- the CLI entry point
 *  below is what turns that into a clean, non-stack-trace exit. */
export function resolveStatsPath({ vault, statsFile }) {
	if (statsFile) {
		if (!isAbsolute(statsFile)) throw new Error(`--stats-file must be an absolute path (got "${statsFile}").`);
		return statsFile;
	}
	if (vault) {
		if (!isAbsolute(vault)) throw new Error(`--vault must be an absolute path (got "${vault}").`);
		return join(vault, PLUGIN_RELATIVE_PATH);
	}
	throw new Error("Provide either --vault <path> or --stats-file <path>. Run with --help for usage.");
}

// ---------------------------------------------------------------------------------------------
// Stats file loading + validation
// ---------------------------------------------------------------------------------------------

/** Reads and validates sort-stats.json, returning its `events` array. Throws a plain, specific
 *  Error (never a raw stack trace) on any failure -- missing file, unreadable file, invalid
 *  JSON, or an unsupported schema version -- so both the startup validation and every live
 *  `/api/stats` request can turn it into a clear message without leaking the file path into a
 *  browser-facing response (callers decide what, if anything, to show where). */
export async function loadStatsEvents(statsPath) {
	let raw;
	try {
		raw = await readFile(statsPath, "utf8");
	} catch (e) {
		if (e && e.code === "ENOENT") {
			throw new Error(`No sort-stats.json found at this location. Amnesiarch only creates this file once "Collect local Sort outcome statistics" has been enabled and at least one Sort has been run.`);
		}
		throw new Error(`Could not read sort-stats.json: ${e instanceof Error ? e.message : String(e)}`);
	}

	let parsed;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new Error("sort-stats.json is not valid JSON.");
	}

	if (!parsed || parsed.version !== STATS_SCHEMA_VERSION || !Array.isArray(parsed.events)) {
		throw new Error(`sort-stats.json has an unsupported schema (expected version ${STATS_SCHEMA_VERSION} with an "events" array).`);
	}

	return parsed.events;
}

// ---------------------------------------------------------------------------------------------
// HTTP handler
// ---------------------------------------------------------------------------------------------

function securityHeaders(contentType) {
	return {
		"Content-Type": contentType,
		"Cache-Control": "no-store",
		// Self-contained page (no external fonts/scripts/stylesheets/images/API requests) --
		// 'unsafe-inline' is needed only because the page's own CSS/JS are inlined into the one
		// HTML document rather than served from separate files, not to permit anything external.
		"Content-Security-Policy":
			"default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
		"X-Content-Type-Options": "nosniff",
	};
}

/** Builds the Node request handler. `statsPath` is read fresh on every `/api/stats` request (not
 *  cached) so the page's periodic refresh/Refresh button reflect newly recorded events without
 *  restarting the server -- and is never itself included in any response body (brief: "Do not
 *  include the absolute vault path in browser responses"). */
export function createRequestHandler(statsPath) {
	return async function handler(req, res) {
		const url = new URL(req.url ?? "/", "http://127.0.0.1");

		if (req.method === "GET" && url.pathname === "/") {
			res.writeHead(200, securityHeaders("text/html; charset=utf-8"));
			res.end(renderPage());
			return;
		}

		if (req.method === "GET" && url.pathname === "/api/stats") {
			try {
				const events = await loadStatsEvents(statsPath);
				const aggregate = computeSortStatsAggregate(events);
				res.writeHead(200, securityHeaders("application/json; charset=utf-8"));
				res.end(JSON.stringify(aggregate));
			} catch (e) {
				res.writeHead(500, securityHeaders("application/json; charset=utf-8"));
				res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
			}
			return;
		}

		res.writeHead(404, securityHeaders("text/plain; charset=utf-8"));
		res.end("Not found");
	};
}

export function createServer(statsPath) {
	return createHttpServer(createRequestHandler(statsPath));
}

// ---------------------------------------------------------------------------------------------
// HTML page (embedded -- no external assets, see securityHeaders()'s CSP above)
// ---------------------------------------------------------------------------------------------

function renderPage() {
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Amnesiarch Sort stats</title>
<style>
${PAGE_CSS}
</style>
</head>
<body>
<main class="wrap">
  <header>
    <h1>Amnesiarch — local Sort stats</h1>
    <p class="sub">Local, descriptive, developer-only. Never sent anywhere. This page reads only <code>/api/stats</code> on this machine.</p>
  </header>

  <section class="banner" role="note">
    Thresholds have not been changed. Review a sufficient real-vault sample before tuning — this dashboard does not recommend or apply any change automatically.
  </section>

  <section id="sample" class="card"></section>

  <section class="grid" id="primary"></section>
  <section class="grid" id="secondary"></section>
  <section class="card" id="created"></section>
  <section class="card" id="friction"></section>
  <section class="card" id="thresholds"></section>
  <section class="card" id="quality"></section>

  <footer>
    <button id="refresh">Refresh</button>
    <button id="copy">Copy anonymized JSON</button>
    <span id="copyStatus" aria-live="polite"></span>
    <span class="auto">Auto-refreshes every 5s.</span>
  </footer>
</main>
<script>
${PAGE_JS}
</script>
</body>
</html>`;
}

const PAGE_CSS = `
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; background: #0f0f12; color: #e7e7ea; }
  @media (prefers-color-scheme: light) { body { background: #f7f7f8; color: #1a1a1e; } }
  .wrap { max-width: 880px; margin: 0 auto; padding: 32px 20px 80px; }
  h1 { font-size: 1.4rem; margin: 0 0 4px; }
  .sub { opacity: 0.7; font-size: 0.9rem; margin: 0 0 20px; }
  code { font-family: ui-monospace, monospace; }
  .banner { font-size: 0.85rem; padding: 10px 14px; border-radius: 8px; background: rgba(130,130,160,0.15); margin-bottom: 20px; }
  .card { border: 1px solid rgba(130,130,160,0.25); border-radius: 10px; padding: 16px 18px; margin-bottom: 16px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px; margin-bottom: 16px; }
  .metric { border: 1px solid rgba(130,130,160,0.25); border-radius: 10px; padding: 14px 16px; }
  .metric h3 { margin: 0 0 6px; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.03em; opacity: 0.7; }
  .metric .value { font-size: 1.6rem; font-weight: 600; }
  .metric .detail { font-size: 0.78rem; opacity: 0.65; margin-top: 4px; }
  h2 { font-size: 0.95rem; margin: 0 0 10px; }
  table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
  td, th { text-align: left; padding: 4px 8px 4px 0; }
  footer { display: flex; align-items: center; gap: 10px; margin-top: 24px; flex-wrap: wrap; }
  button { font: inherit; padding: 8px 14px; border-radius: 8px; border: 1px solid rgba(130,130,160,0.4); background: transparent; color: inherit; cursor: pointer; }
  button:hover { background: rgba(130,130,160,0.15); }
  .auto { font-size: 0.78rem; opacity: 0.6; }
  #copyStatus { font-size: 0.78rem; opacity: 0.75; }
`;

const PAGE_JS = `
function pct(rate) { return rate == null ? "—" : (rate * 100).toFixed(1) + "%"; }
function frac(stat) { return stat.denominator > 0 ? stat.numerator + " / " + stat.denominator : "no data yet"; }
function ms(v) { return v == null ? "—" : (v < 1000 ? Math.round(v) + " ms" : (v / 1000).toFixed(1) + " s"); }
function fmtDate(t) { return t == null ? "—" : new Date(t).toLocaleString(); }
function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

function metricCard(title, stat, note) {
  return '<div class="metric"><h3>' + esc(title) + '</h3><div class="value">' + pct(stat.rate) + '</div>' +
    '<div class="detail">' + esc(frac(stat)) + (note ? " — " + esc(note) : "") + '</div></div>';
}

let latest = null;

async function refresh() {
  const res = await fetch("/api/stats", { cache: "no-store" });
  const data = await res.json();
  if (data.error) {
    document.getElementById("sample").innerHTML = '<p>' + esc(data.error) + '</p>';
    return;
  }
  latest = data;
  render(data);
}

function render(d) {
  document.getElementById("sample").innerHTML =
    '<h2>Sample</h2><table>' +
    '<tr><td>Presented</td><td>' + d.sampleSize + '</td></tr>' +
    '<tr><td>Resolved</td><td>' + d.resolvedSampleSize + '</td></tr>' +
    '<tr><td>Date range</td><td>' + esc(fmtDate(d.firstTimestamp)) + ' – ' + esc(fmtDate(d.lastTimestamp)) + '</td></tr>' +
    '</table>' +
    (d.sampleSize < 50 ? '<p class="detail">Fewer than 50 resolved Sorts recorded so far — treat any rate below as preliminary, not statistically meaningful yet.</p>' : '');

  document.getElementById("primary").innerHTML =
    metricCard("Top accepted", d.topAccepted, "confident-match card, direct accept") +
    metricCard("Reassigned", d.reassigned, "ended up somewhere other than the top result") +
    metricCard("No confident match", d.noConfidentMatch, "of Sorts with candidates to compare");

  document.getElementById("secondary").innerHTML =
    metricCard("Ambiguous-state frequency", d.ambiguousFrequency, "relevant to MIN_MARGIN") +
    metricCard("Low-confidence rescue rate", d.lowConfidenceRescueRate, "found via Search instead") +
    metricCard("Confident override rate", d.confidentOverrideRate, "evidence of false confidence");

  const phases = ["confident", "ambiguous", "low-confidence", "empty-index"];
  document.getElementById("created").innerHTML =
    '<h2>Created notes, by original phase</h2><table><tr><th>Phase</th><th>Rate</th><th>Count</th></tr>' +
    phases.map((p) => '<tr><td>' + p + '</td><td>' + pct(d.createdNoteByPhase[p].rate) + '</td><td>' + esc(frac(d.createdNoteByPhase[p])) + '</td></tr>').join("") +
    '</table>';

  document.getElementById("friction").innerHTML =
    '<h2>Dismissal &amp; timing</h2><table>' +
    '<tr><td>Dismissed rate</td><td>' + pct(d.dismissedRate.rate) + ' (' + esc(frac(d.dismissedRate)) + ')</td></tr>' +
    '<tr><td>Abandoned (view closed)</td><td>' + d.abandonedCount + ' — excluded from the rates above</td></tr>' +
    phases.map((p) => '<tr><td>Median decision time — ' + p + '</td><td>' + ms(d.medianDecisionMsByPhase[p]) + '</td></tr>').join("") +
    '</table>';

  document.getElementById("thresholds").innerHTML =
    '<h2>Thresholds observed</h2>' +
    (d.currentThreshold ? '<p>Current: MIN_CONFIDENCE ' + d.currentThreshold.minConfidence + ' · MIN_MARGIN ' + d.currentThreshold.minMargin + '</p>' : '<p>No data yet.</p>') +
    '<table><tr><th>MIN_CONFIDENCE</th><th>MIN_MARGIN</th><th>Count</th><th>Last seen</th></tr>' +
    d.observedThresholds.map((t) => '<tr><td>' + t.minConfidence + '</td><td>' + t.minMargin + '</td><td>' + t.count + '</td><td>' + esc(fmtDate(t.lastSeen)) + '</td></tr>').join("") +
    '</table>';

  document.getElementById("quality").innerHTML =
    '<h2>Data-quality diagnostics (excluded from every rate above)</h2><table>' +
    '<tr><td>Empty-index Sorts</td><td>' + d.emptyIndexCount + '</td></tr>' +
    '<tr><td>Incomplete-index Sorts (index still building)</td><td>' + d.incompleteIndexCount + '</td></tr>' +
    '</table>';
}

document.getElementById("refresh").addEventListener("click", refresh);
document.getElementById("copy").addEventListener("click", async () => {
  if (!latest) return;
  await navigator.clipboard.writeText(JSON.stringify(latest, null, 2));
  const status = document.getElementById("copyStatus");
  status.textContent = "Copied.";
  setTimeout(() => { status.textContent = ""; }, 2000);
});

refresh();
setInterval(refresh, 5000);
`;

// ---------------------------------------------------------------------------------------------
// Browser opening (best-effort, optional)
// ---------------------------------------------------------------------------------------------

function openBrowser(url) {
	try {
		const platform = process.platform;
		const cmd = platform === "darwin" ? "open" : platform === "win32" ? "cmd" : "xdg-open";
		const args = platform === "win32" ? ["/c", "start", "", url] : [url];
		spawn(cmd, args, { stdio: "ignore", detached: true }).unref();
	} catch (e) {
		console.error(`Amnesiarch: couldn't open a browser automatically (${e instanceof Error ? e.message : String(e)}) -- open the URL above manually.`);
	}
}

// ---------------------------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------------------------

async function main() {
	const args = parseArgs(process.argv.slice(2));

	let statsPath;
	try {
		statsPath = resolveStatsPath(args);
	} catch (e) {
		console.error(`Amnesiarch: ${e instanceof Error ? e.message : String(e)}`);
		process.exitCode = 1;
		return;
	}

	// Validate up front so a bad path fails with a clear terminal message before ever binding a
	// socket (brief: "Validate the path and schema before serving" / "Invalid stats paths fail
	// with a useful terminal message").
	try {
		await loadStatsEvents(statsPath);
	} catch (e) {
		console.error(`Amnesiarch: ${e instanceof Error ? e.message : String(e)}`);
		console.error(`Reading: ${statsPath}`);
		process.exitCode = 1;
		return;
	}

	const server = createServer(statsPath);
	const desiredPort = Number.isFinite(args.port) && args.port > 0 ? args.port : DEFAULT_PORT;

	const listenOn = (port) =>
		new Promise((resolve, reject) => {
			const onError = (e) => {
				server.removeListener("listening", onListening);
				reject(e);
			};
			const onListening = () => {
				server.removeListener("error", onError);
				resolve();
			};
			server.once("error", onError);
			server.once("listening", onListening);
			// 127.0.0.1 explicitly, never 0.0.0.0 (brief: "Bind an HTTP server to 127.0.0.1, never
			// 0.0.0.0").
			server.listen(port, "127.0.0.1");
		});

	try {
		await listenOn(desiredPort);
	} catch (e) {
		if (e && e.code === "EADDRINUSE") {
			console.error(`Amnesiarch: port ${desiredPort} is already in use -- falling back to an automatically-assigned loopback port.`);
			await listenOn(0);
		} else {
			throw e;
		}
	}

	const address = server.address();
	const port = typeof address === "object" && address ? address.port : desiredPort;
	console.log(`Amnesiarch Sort stats: http://127.0.0.1:${port}`);
	console.log(`Reading: ${statsPath}`);
	console.log("Press Ctrl-C to stop.");

	if (args.open) openBrowser(`http://127.0.0.1:${port}`);

	const shutdown = () => {
		server.close(() => process.exit(0));
	};
	process.on("SIGINT", shutdown);
	process.on("SIGTERM", shutdown);
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
	main().catch((e) => {
		console.error("Amnesiarch: unexpected error", e);
		process.exitCode = 1;
	});
}
