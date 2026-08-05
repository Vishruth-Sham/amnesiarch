export interface AmnesiarchSettings {
	/** Folder path prefixes excluded from indexing entirely -- never embedded, never suggested
	 *  as an append target. See src/index/ExcludeMatcher.ts for match semantics. */
	excludePatterns: string[];
	/** Opt-in (default false): local-only, content-free recording of Sort decision outcomes to
	 *  sort-stats.json, for later threshold tuning (see src/stats/). Never affects search,
	 *  scoring, ranking, note creation, destination selection, or append/create behavior --
	 *  observation only. Disabling stops new events without deleting existing ones -- see
	 *  SortStatsStore. */
	collectSortStats: boolean;
}

export const DEFAULT_SETTINGS: AmnesiarchSettings = {
	excludePatterns: [],
	collectSortStats: false,
};
