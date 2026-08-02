import { App, PluginSettingTab, Setting, SettingDefinitionItem } from "obsidian";
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
				],
			},
		];
	}

	getControlValue(key: string): unknown {
		if (key === EXCLUDE_PATTERNS_CONTROL_KEY) return this.plugin.settings.excludePatterns.join("\n");
		return undefined;
	}

	setControlValue(key: string, value: unknown): void | Promise<void> {
		if (key !== EXCLUDE_PATTERNS_CONTROL_KEY) return;
		this.plugin.settings.excludePatterns = String(value)
			.split("\n")
			.map((s) => s.trim())
			.filter(Boolean);
		return this.plugin.saveSettings();
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
	}
}
