import { App, PluginSettingTab, Setting } from "obsidian";
import type AiNotesPlugin from "../../main";

export class AiNotesSettingsTab extends PluginSettingTab {
	constructor(
		app: App,
		private plugin: AiNotesPlugin,
	) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl).setName("Indexing").setHeading();

		new Setting(containerEl)
			.setName("Exclude from indexing")
			.setDesc(
				"One folder path per line (e.g. \"Templates\", \"Archive/2023\"). Notes under these " +
					"paths are never embedded or suggested as an append target. Changes apply to notes " +
					"indexed or edited after saving -- they don't retroactively remove already-cached notes " +
					"until those notes next change (or you run \"AI Notes: Rebuild index\" -- see command palette).",
			)
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
