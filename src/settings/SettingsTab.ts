import { App, Modal, Notice, PluginSettingTab, Setting, SettingDefinitionItem } from "obsidian";
import type AmnesiarchPlugin from "../../main";

/** Shown for "Exclude from indexing" in both display() (the actual rendered tab) and
 *  getSettingDefinitions() (Obsidian 1.13+'s in-app settings search index) -- kept as one
 *  constant so the two descriptions can never drift apart. */
const EXCLUDE_PATTERNS_DESC =
	"One folder path per line (e.g. \"Templates\", \"Archive/2023\"). Notes under these " +
	"paths are never embedded or suggested as an append target. Changes apply to notes " +
	"indexed or edited after saving -- they don't retroactively remove already-cached notes " +
	"until those notes next change (or you run \"Amnesiarch: Rebuild index\" -- see command palette).";

/** Synthetic control key for getSettingDefinitions()/getControlValue()/setControlValue() below --
 *  deliberately not "excludePatterns" itself, since the declarative control's value is a single
 *  newline-joined string (matching the textarea it renders) while the real setting is a
 *  string[]; getControlValue()/setControlValue() are what translate between the two, the same
 *  way display()'s own addTextArea() callback already does. */
const EXCLUDE_PATTERNS_CONTROL_KEY = "excludePatternsText";
const REBUILD_INDEX_DESC = "Rebuild the local index now so newly excluded notes stop appearing in suggestions.";

/** Opt-in, off by default -- see src/settings/Settings.ts's collectSortStats doc comment for why
 *  (Community Plugin review posture: opt-in is the safer default for existing-plugin behavior
 *  changes, even though the data itself is local and content-free). */
const COLLECT_SORT_STATS_DESC =
	"Locally records how often Sort's suggestions are accepted, overridden, or dismissed, to " +
	'help tune matching thresholds later. Stored only in this vault\'s plugin directory, as ' +
	"counts, ranks, scores, and timing -- never note text, titles, paths, folders, tags, or " +
	"search queries. Off by default. See the README's \"Local Sort statistics\" section for " +
	"exactly what is and isn't recorded, and how to view it with the local dashboard " +
	"(`npm run stats`).";
const COLLECT_SORT_STATS_CONTROL_KEY = "collectSortStats";

const RESET_SORT_STATS_DESC =
	"Permanently deletes every recorded Sort outcome event for this vault. Does not affect " +
	"search, the note index, or any other setting. Cannot be undone.";

/** A small, self-contained confirmation dialog -- not Obsidian's built-in `ConfirmationModal`,
 *  which needs 1.13.0 and would force a further minAppVersion bump just for this one button;
 *  the plain `Modal` base class has no such requirement. */
class ResetSortStatsModal extends Modal {
	constructor(
		app: App,
		private onConfirm: () => void,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.createEl("h2", { text: "Reset local Sort statistics?" });
		contentEl.createEl("p", { text: RESET_SORT_STATS_DESC });
		new Setting(contentEl)
			.addButton((btn) => btn.setButtonText("Cancel").onClick(() => this.close()))
			.addButton((btn) =>
				btn
					.setButtonText("Reset statistics")
					.setWarning()
					.onClick(() => {
						this.close();
						this.onConfirm();
					}),
			);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

export class AmnesiarchSettingsTab extends PluginSettingTab {
	constructor(
		app: App,
		private plugin: AmnesiarchPlugin,
	) {
		super(app, plugin);
	}

	/** Obsidian 1.13+ calls this to index settings for its cross-plugin settings search --
	 *  additive only: display() below is still what actually renders this tab when opened
	 *  directly, on every supported Obsidian version. A plugin with exactly one setting is a
	 *  small enough surface that duplicating its name/description here (rather than trying to
	 *  derive display() from this, or vice versa) is the least-invasive option. */
	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{
				type: "group",
				heading: "Indexing",
				items: [
					{
						name: "Exclude from indexing",
						desc: EXCLUDE_PATTERNS_DESC,
						control: {
							type: "textarea",
							key: EXCLUDE_PATTERNS_CONTROL_KEY,
							placeholder: "Templates\nArchive",
							rows: 4,
						},
					},
					{
						name: "Apply exclusion changes",
						desc: REBUILD_INDEX_DESC,
						action: () => void this.rebuildIndex(),
					},
				],
			},
			{
				type: "group",
				heading: "Sort statistics",
				items: [
					{
						name: "Collect local Sort outcome statistics",
						desc: COLLECT_SORT_STATS_DESC,
						control: {
							type: "toggle",
							key: COLLECT_SORT_STATS_CONTROL_KEY,
						},
					},
					{
						name: "Reset local Sort statistics",
						desc: RESET_SORT_STATS_DESC,
						action: () => this.openResetSortStatsModal(),
					},
				],
			},
		];
	}

	getControlValue(key: string): unknown {
		if (key === EXCLUDE_PATTERNS_CONTROL_KEY) return this.plugin.settings.excludePatterns.join("\n");
		if (key === COLLECT_SORT_STATS_CONTROL_KEY) return this.plugin.settings.collectSortStats;
		return undefined;
	}

	setControlValue(key: string, value: unknown): void | Promise<void> {
		if (key === EXCLUDE_PATTERNS_CONTROL_KEY) {
			this.plugin.settings.excludePatterns = String(value)
				.split("\n")
				.map((s) => s.trim())
				.filter(Boolean);
			return this.plugin.saveSettings();
		}
		if (key === COLLECT_SORT_STATS_CONTROL_KEY) {
			this.plugin.settings.collectSortStats = Boolean(value);
			return this.plugin.saveSettings();
		}
	}

	private openResetSortStatsModal(): void {
		new ResetSortStatsModal(this.app, () => {
			void this.plugin.sortStats
				.reset()
				.then(() => new Notice("Amnesiarch: local Sort statistics reset."))
				.catch((e) => {
					console.error("Amnesiarch: failed to reset sort statistics", e);
					new Notice("Amnesiarch: couldn't reset Sort statistics — see console for details.");
				});
		}).open();
	}

	private async rebuildIndex(): Promise<void> {
		new Notice("Amnesiarch: rebuilding index from scratch…");
		try {
			await this.plugin.indexer.rebuildAll();
			new Notice(`Amnesiarch: rebuilt (${this.plugin.cache.size()} notes indexed).`);
		} catch (e) {
			console.error("Amnesiarch: failed to rebuild index", e);
			new Notice("Amnesiarch: couldn't rebuild the index — see console for details.");
		}
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl).setName("Indexing").setHeading();

		new Setting(containerEl)
			.setName("Exclude from indexing")
			.setDesc(EXCLUDE_PATTERNS_DESC)
			.addTextArea((text) =>
				text
					.setPlaceholder("Templates\nArchive")
					.setValue(this.plugin.settings.excludePatterns.join("\n"))
					.onChange(async (value) => {
						this.plugin.settings.excludePatterns = value
							.split("\n")
							.map((s) => s.trim())
							.filter(Boolean);
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Apply exclusion changes")
			.setDesc(REBUILD_INDEX_DESC)
			.addButton((button) =>
				button.setButtonText("Rebuild index").onClick(() => {
					button.setDisabled(true).setButtonText("Rebuilding…");
					void this.rebuildIndex()
						.finally(() => button.setDisabled(false).setButtonText("Rebuild index"));
				}),
			);

		new Setting(containerEl).setName("Sort statistics").setHeading();

		new Setting(containerEl)
			.setName("Collect local Sort outcome statistics")
			.setDesc(COLLECT_SORT_STATS_DESC)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.collectSortStats).onChange(async (value) => {
					this.plugin.settings.collectSortStats = value;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("Reset local Sort statistics")
			.setDesc(RESET_SORT_STATS_DESC)
			.addButton((btn) =>
				btn
					.setButtonText("Reset")
					.setWarning()
					.onClick(() => this.openResetSortStatsModal()),
			);
	}
}
