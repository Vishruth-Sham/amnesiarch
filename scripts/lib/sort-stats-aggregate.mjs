/**
 * Plain-JS mirror of src/stats/SortStatsAggregation.ts's computeSortStatsAggregate().
 *
 * This is a deliberate duplication, not a shared import: scripts/sort-stats-dashboard.mjs runs
 * as a standalone Node script with `node scripts/sort-stats-dashboard.mjs`, no TypeScript build
 * step and no dependency beyond Node built-ins (implementation brief: "Use Node built-ins only
 * ... No Express, charting package, frontend framework, or analytics dependency"). Reaching into
 * src/stats/SortStatsAggregation.ts (a .ts file) would require esbuild/tsc at dashboard-runtime,
 * which is exactly the kind of extra machinery the brief asks this script to avoid.
 *
 * Keep this in lockstep with SortStatsAggregation.ts by hand -- see tests/stats/
 * SortStatsAggregation.test.ts and tests/stats/dashboard-aggregate-parity.test.ts, which run the
 * same fixtures through both implementations and assert identical output.
 */

const SUCCESS_OUTCOMES = new Set(["accepted-top", "selected-alternate", "manual-confirmed-top", "manual-selected-other", "created-note"]);

const ALL_PHASES = ["confident", "ambiguous", "low-confidence", "empty-index"];

function rateStat(numerator, denominator) {
	return { numerator, denominator, rate: denominator > 0 ? numerator / denominator : null };
}

function median(values) {
	if (values.length === 0) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function computeSortStatsAggregate(events) {
	const presented = events.filter((e) => e.kind === "sort-presented");
	const resolved = events.filter((e) => e.kind === "sort-resolved");
	const resolvedById = new Map(resolved.map((e) => [e.sortId, e]));

	const timestamps = events.map((e) => e.timestamp);
	const firstTimestamp = timestamps.length ? Math.min(...timestamps) : null;
	const lastTimestamp = timestamps.length ? Math.max(...timestamps) : null;

	const emptyIndexCount = presented.filter((p) => p.phase === "empty-index").length;
	const incompleteIndexCount = presented.filter((p) => p.indexWasBuilding).length;

	const eligible = presented.filter((p) => !p.indexWasBuilding);

	const successfulInPhases = (phases) =>
		eligible
			.filter((p) => phases.includes(p.phase))
			.map((p) => ({ presented: p, resolved: resolvedById.get(p.sortId) }))
			.filter((pair) => !!pair.resolved && SUCCESS_OUTCOMES.has(pair.resolved.outcome));

	const confidentSuccess = successfulInPhases(["confident"]);
	const topAccepted = rateStat(
		confidentSuccess.filter((p) => p.resolved.outcome === "accepted-top").length,
		confidentSuccess.length,
	);
	const confidentOverrideRate = rateStat(
		confidentSuccess.filter((p) => p.resolved.outcome === "manual-selected-other" || p.resolved.outcome === "created-note").length,
		confidentSuccess.length,
	);

	const confidentOrAmbiguousSuccess = successfulInPhases(["confident", "ambiguous"]);
	const reassigned = rateStat(
		confidentOrAmbiguousSuccess.filter((p) => p.resolved.outcome !== "accepted-top" && p.resolved.outcome !== "manual-confirmed-top").length,
		confidentOrAmbiguousSuccess.length,
	);

	const evaluated = eligible.filter((p) => p.phase !== "empty-index");
	const noConfidentMatch = rateStat(evaluated.filter((p) => p.phase === "low-confidence").length, evaluated.length);
	const ambiguousFrequency = rateStat(evaluated.filter((p) => p.phase === "ambiguous").length, evaluated.length);

	const lowConfidencePresented = eligible.filter((p) => p.phase === "low-confidence");
	const lowConfidenceRescueRate = rateStat(
		lowConfidencePresented.filter((p) => {
			const r = resolvedById.get(p.sortId);
			return !!r && (r.outcome === "manual-confirmed-top" || r.outcome === "manual-selected-other");
		}).length,
		lowConfidencePresented.length,
	);

	const createdNoteByPhase = Object.fromEntries(
		ALL_PHASES.map((phase) => {
			const inPhase = eligible.filter((p) => p.phase === phase);
			const created = inPhase.filter((p) => resolvedById.get(p.sortId)?.outcome === "created-note").length;
			return [phase, rateStat(created, inPhase.length)];
		}),
	);

	const dismissedRate = rateStat(
		presented.filter((p) => resolvedById.get(p.sortId)?.outcome === "dismissed").length,
		presented.length,
	);
	const abandonedCount = presented.filter((p) => resolvedById.get(p.sortId)?.outcome === "abandoned").length;

	const medianDecisionMsByPhase = Object.fromEntries(
		ALL_PHASES.map((phase) => {
			const times = presented
				.filter((p) => p.phase === phase)
				.map((p) => resolvedById.get(p.sortId)?.decisionMs)
				.filter((ms) => typeof ms === "number");
			return [phase, median(times)];
		}),
	);

	const thresholdMap = new Map();
	for (const p of presented) {
		const key = `${p.minConfidence}:${p.minMargin}`;
		const existing = thresholdMap.get(key);
		if (existing) {
			existing.count++;
			existing.firstSeen = Math.min(existing.firstSeen, p.timestamp);
			existing.lastSeen = Math.max(existing.lastSeen, p.timestamp);
		} else {
			thresholdMap.set(key, { minConfidence: p.minConfidence, minMargin: p.minMargin, count: 1, firstSeen: p.timestamp, lastSeen: p.timestamp });
		}
	}
	const observedThresholds = Array.from(thresholdMap.values()).sort((a, b) => b.lastSeen - a.lastSeen);
	const currentThreshold = observedThresholds[0]
		? { minConfidence: observedThresholds[0].minConfidence, minMargin: observedThresholds[0].minMargin }
		: null;

	return {
		sampleSize: presented.length,
		resolvedSampleSize: resolved.length,
		firstTimestamp,
		lastTimestamp,
		topAccepted,
		reassigned,
		noConfidentMatch,
		ambiguousFrequency,
		lowConfidenceRescueRate,
		confidentOverrideRate,
		createdNoteByPhase,
		dismissedRate,
		abandonedCount,
		medianDecisionMsByPhase,
		emptyIndexCount,
		incompleteIndexCount,
		currentThreshold,
		observedThresholds,
	};
}
