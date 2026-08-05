// Type declarations for the plain-JS aggregate mirror (see that file's header comment for why
// it's a separate .mjs, not a compiled import of SortStatsAggregation.ts). This file is
// compile-time only -- it exists so tests/stats/dashboard-aggregate-parity.test.ts and
// tests/stats/sort-stats-dashboard.test.ts can import the .mjs from TypeScript with real types,
// not `any`. It adds no runtime dependency: declaration files are fully erased at build time.
import type { SortStatsAggregate } from "../../src/stats/SortStatsAggregation";
import type { SortStatsEvent } from "../../src/stats/SortOutcome";

export function computeSortStatsAggregate(events: readonly SortStatsEvent[]): SortStatsAggregate;
