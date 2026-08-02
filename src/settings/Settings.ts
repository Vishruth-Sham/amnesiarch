export interface AmnesiarchSettings {
	/** Folder path prefixes excluded from indexing entirely -- never embedded, never suggested
	 *  as an append target. See src/index/ExcludeMatcher.ts for match semantics. */
	excludePatterns: string[];
}

export const DEFAULT_SETTINGS: AmnesiarchSettings = {
	excludePatterns: [],
};
