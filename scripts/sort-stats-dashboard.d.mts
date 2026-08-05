// Type declarations for the standalone dashboard CLI script -- see sort-stats-aggregate.d.mts's
// header comment for why this exists (compile-time only, no runtime dependency added).
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { SortStatsEvent } from "../src/stats/SortOutcome";

export interface DashboardArgs {
	vault: string | null;
	statsFile: string | null;
	port: number;
	open: boolean;
}

export const STATS_SCHEMA_VERSION: number;
export const DEFAULT_PORT: number;

export function parseArgs(argv: string[]): DashboardArgs;
export function resolveStatsPath(args: { vault: string | null; statsFile: string | null }): string;
export function loadStatsEvents(statsPath: string): Promise<SortStatsEvent[]>;
export function createRequestHandler(statsPath: string): (req: IncomingMessage, res: ServerResponse) => Promise<void>;
export function createServer(statsPath: string): Server;
