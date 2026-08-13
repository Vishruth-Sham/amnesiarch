import { App } from "obsidian";
import { STATS_FILE_NAME, STATS_RETENTION_LIMIT, STATS_SAVE_DEBOUNCE_MS, STATS_SCHEMA_VERSION } from "../constants";
import { SortPresentedEvent, SortResolvedEvent, SortStatsEvent, SortStatsFile } from "./SortOutcome";

/**
 * Persists local Sort outcome events to `sort-stats.json` in the plugin directory (never
 * `notes-cache.json` or settings `data.json` -- see the implementation brief's "Persistence"
 * section for why). Mirrors NoteCache's adapter-based load/debounced-save/flush shape, plus:
 * write serialization (so a presentation event immediately followed by its resolution can never
 * race each other to disk), duplicate-resolution rejection, and bounded pair-wise retention.
 *
 * Recording is always best-effort: every public record method swallows its own errors. A
 * statistics write failure must never prevent a Sort decision card from appearing or an
 * append/create from completing (implementation brief: "Statistics failures never block Sort,
 * append, or create behavior").
 */
export class SortStatsStore {
	private events: SortStatsEvent[] = [];
	private resolvedSortIds = new Set<string>();
	// number, not ReturnType<typeof window.setTimeout> -- see NoteCache.ts's saveTimer comment
	// for the overload-resolution quirk this sidesteps.
	private saveTimer: number | null = null;
	/** Every actual disk write chains onto this promise rather than firing independently, so
	 *  concurrent debounced-write/flush/reset calls always serialize through the vault adapter
	 *  one at a time instead of racing each other. */
	private writeChain: Promise<void> = Promise.resolve();

	constructor(
		private app: App,
		private pluginDir: string,
		/** Live getter (not a snapshot), mirroring VaultIndexer's getExcludePatterns -- so
		 *  toggling the setting takes effect on the very next Sort without reconstructing this
		 *  store. */
		private isEnabled: () => boolean,
	) {}

	private get statsPath(): string {
		return `${this.pluginDir}/${STATS_FILE_NAME}`;
	}

	async load(): Promise<void> {
		this.events = [];
		this.resolvedSortIds.clear();
		const adapter = this.app.vault.adapter;
		if (!(await adapter.exists(this.statsPath))) return;

		let raw: string;
		try {
			raw = await adapter.read(this.statsPath);
		} catch (e) {
			console.error("Amnesiarch: failed to read sort-stats.json, starting fresh", e);
			return;
		}

		let parsed: unknown;
		try {
			parsed = JSON.parse(raw);
		} catch (e) {
			console.error("Amnesiarch: sort-stats.json is not valid JSON, starting fresh", e);
			await this.backupCorruptFile(raw);
			return;
		}

		const file = parsed as Partial<SortStatsFile> | null;
		if (!file || file.version !== STATS_SCHEMA_VERSION || !Array.isArray(file.events)) {
			console.error(
				`Amnesiarch: sort-stats.json has an unsupported schema, starting fresh (found version: ${JSON.stringify((file as { version?: unknown } | null)?.version)})`,
			);
			await this.backupCorruptFile(raw);
			return;
		}

		this.events = file.events;
		for (const e of this.events) {
			if (e.kind === "sort-resolved") this.resolvedSortIds.add(e.sortId);
		}
	}

	/** Preserves an unreadable/unsupported file as a timestamped local backup before starting a
	 *  fresh schema file, so a corrupt write never just silently destroys prior data. Best-effort
	 *  -- a failed backup must never block starting fresh. */
	private async backupCorruptFile(raw: string): Promise<void> {
		try {
			const backupPath = `${this.pluginDir}/sort-stats.corrupt.${Date.now()}.json`;
			await this.app.vault.adapter.write(backupPath, raw);
		} catch (e) {
			console.error("Amnesiarch: failed to back up corrupt sort-stats.json", e);
		}
	}

	recordPresented(event: SortPresentedEvent): void {
		if (!this.isEnabled()) return;
		try {
			this.events.push(event);
			this.scheduleSave();
		} catch (e) {
			console.error("Amnesiarch: failed to record sort-presented event", e);
		}
	}

	recordResolved(event: SortResolvedEvent): void {
		if (!this.isEnabled()) return;
		try {
			if (this.resolvedSortIds.has(event.sortId)) {
				// Duplicate finalization -- never double-count one Sort's resolution.
				console.warn(`Amnesiarch: sortId ${event.sortId} was already resolved, ignoring duplicate`);
				return;
			}
			this.resolvedSortIds.add(event.sortId);
			this.events.push(event);
			this.pruneRetention();
			this.scheduleSave();
		} catch (e) {
			console.error("Amnesiarch: failed to record sort-resolved event", e);
		}
	}

	getEvents(): readonly SortStatsEvent[] {
		return this.events;
	}

	/** Debounced write -- coalesces a presentation event and its (often fast-following)
	 *  resolution into a single disk write, same pattern as NoteCache.scheduleSave(). */
	private scheduleSave(): void {
		if (this.saveTimer) return;
		this.saveTimer = window.setTimeout(() => {
			this.saveTimer = null;
			this.enqueueWrite();
		}, STATS_SAVE_DEBOUNCE_MS);
	}

	/** Write immediately, bypassing the debounce, and wait for every write enqueued so far
	 *  (including this one) to land -- used on plugin unload so a pending debounced write is
	 *  never lost. */
	async flush(): Promise<void> {
		if (this.saveTimer) {
			window.clearTimeout(this.saveTimer);
			this.saveTimer = null;
		}
		this.enqueueWrite();
		await this.writeChain;
	}

	/** Explicit reset (SettingsTab's "Reset local Sort statistics" action, always gated behind a
	 *  confirmation at the call site) -- clears memory and disk immediately, regardless of
	 *  whether collection is currently enabled. A reset must work even while disabled: the point
	 *  is deleting what's already there, independent of whether new events are being recorded. */
	async reset(): Promise<void> {
		this.events = [];
		this.resolvedSortIds.clear();
		if (this.saveTimer) {
			window.clearTimeout(this.saveTimer);
			this.saveTimer = null;
		}
		this.enqueueWrite();
		await this.writeChain;
	}

	private enqueueWrite(): void {
		const snapshot: SortStatsFile = { version: STATS_SCHEMA_VERSION, events: this.events.slice() };
		this.writeChain = this.writeChain
			.then(() => this.app.vault.adapter.write(this.statsPath, JSON.stringify(snapshot)))
			.catch((e) => {
				console.error("Amnesiarch: failed to write sort-stats.json", e);
			});
	}

	/**
	 * Keeps only the latest STATS_RETENTION_LIMIT Sort *presentations*, plus whichever of those
	 * have a matching resolution. Pruning by sortId means a presentation+resolution pair is
	 * always kept or dropped together, never split (implementation brief: "Prune complete
	 * presentation-resolution pairs rather than individual records"). An unresolved presentation
	 * ages out exactly like a resolved one -- nothing here treats "still pending" as exempt, so
	 * abandoned/never-finalized Sorts can't grow the file unboundedly either.
	 */
	private pruneRetention(): void {
		const presented = this.events.filter((e): e is SortPresentedEvent => e.kind === "sort-presented");
		if (presented.length <= STATS_RETENTION_LIMIT) return;

		const keepIds = new Set(
			presented
				.slice()
				.sort((a, b) => b.timestamp - a.timestamp)
				.slice(0, STATS_RETENTION_LIMIT)
				.map((e) => e.sortId),
		);
		this.events = this.events.filter((e) => keepIds.has(e.sortId));
		for (const id of Array.from(this.resolvedSortIds)) {
			if (!keepIds.has(id)) this.resolvedSortIds.delete(id);
		}
	}
}
