import { Notice, Plugin, TFile, WorkspaceLeaf } from "obsidian";
import { VIEW_TYPE_AI_NOTES_QUICK_CAPTURE, LEGACY_VIEW_TYPE_AI_NOTES_CHAT } from "src/constants";
import { NoteCache } from "src/index/NoteCache";
import { VaultIndexer } from "src/index/VaultIndexer";
import { AiNotesSettings, DEFAULT_SETTINGS } from "src/settings/Settings";
import { AiNotesSettingsTab } from "src/settings/SettingsTab";
import { ProfileCache } from "src/search/ProfileCache";
import { QuickCaptureView } from "src/view/QuickCaptureView";

export default class AiNotesPlugin extends Plugin {
	cache!: NoteCache;
	indexer!: VaultIndexer;
	profileCache!: ProfileCache;
	settings!: AiNotesSettings;

	async onload(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());

		this.cache = new NoteCache(this.app, this.manifest.dir ?? `.obsidian/plugins/${this.manifest.id}`);
		this.indexer = new VaultIndexer(this.app, this.cache, () => this.settings.excludePatterns);
		this.profileCache = new ProfileCache(this.cache);

		this.addSettingTab(new AiNotesSettingsTab(this.app, this));

		this.registerView(VIEW_TYPE_AI_NOTES_QUICK_CAPTURE, (leaf: WorkspaceLeaf) => new QuickCaptureView(leaf, this));

		this.addRibbonIcon("inbox", "Open Quick Capture", () => {
			void this.activateView();
		});

		this.addCommand({
			// Stable ID preserved across the chat-panel-to-Quick-Capture rename so any hotkey a
			// user already assigned to this command keeps working -- only the visible name and
			// what it opens changed.
			id: "open-ai-notes-chat",
			name: "Open Quick Capture",
			callback: () => void this.activateView(),
		});

		this.addCommand({
			id: "rebuild-index",
			name: "Rebuild index",
			callback: () => {
				new Notice("AI Notes: rebuilding index from scratch…");
				void this.indexer.rebuildAll().then(() => new Notice(`AI Notes: rebuilt (${this.cache.size()} notes indexed).`));
			},
		});

		this.addCommand({
			id: "show-vault-profile",
			name: "Show vault profile (debug)",
			callback: () => {
				const profile = this.profileCache.getProfile();
				const weights = this.profileCache.getWeights();
				if (!profile) {
					new Notice("AI Notes: no notes indexed yet.");
					return;
				}
				console.log("AI Notes: vault profile", profile);
				console.log("AI Notes: derived structural weights", weights);
				new Notice(
					`AI Notes vault profile (full detail in console):\n` +
						`${profile.noteCount} notes · title ${weights.title.toFixed(2)} · ` +
						`folder ${weights.folder.toFixed(2)} · tag ${weights.tag.toFixed(2)}`,
					8000,
				);
			},
		});

		this.registerEvent(
			this.app.vault.on("modify", (file) => {
				if (file instanceof TFile && file.extension === "md") this.indexer.queue(file.path);
			}),
		);
		this.registerEvent(
			this.app.vault.on("create", (file) => {
				if (file instanceof TFile && file.extension === "md") this.indexer.queue(file.path);
			}),
		);
		this.registerEvent(
			this.app.vault.on("delete", (file) => {
				if (file instanceof TFile && file.extension === "md") this.indexer.remove(file.path);
			}),
		);
		this.registerEvent(
			this.app.vault.on("rename", (file, oldPath) => {
				if (file instanceof TFile && file.extension === "md") this.indexer.rename(oldPath, file.path);
			}),
		);

		// Don't block plugin load on a potentially slow first-time vault index.
		this.app.workspace.onLayoutReady(() => {
			// A saved workspace layout from before the chat-panel-to-Quick-Capture rename can
			// still reference the old view-type string; nothing is registered for it anymore, so
			// detach it rather than leaving Obsidian to show a broken "missing view" leaf.
			this.app.workspace.detachLeavesOfType(LEGACY_VIEW_TYPE_AI_NOTES_CHAT);
			void this.indexer.initialize().catch((e) => console.error("AI Notes: indexing failed", e));
		});
	}

	onunload(): void {
		this.app.workspace.detachLeavesOfType(VIEW_TYPE_AI_NOTES_QUICK_CAPTURE);
		// Flush any pending debounced cache write (NoteCache.scheduleSave()) immediately rather
		// than losing up to CACHE_SAVE_DEBOUNCE_MS of indexing progress on quit/disable.
		void this.cache.flush().catch((e) => console.error("AI Notes: failed to flush cache on unload", e));
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	async activateView(): Promise<void> {
		const { workspace } = this.app;
		let leaf = workspace.getLeavesOfType(VIEW_TYPE_AI_NOTES_QUICK_CAPTURE)[0];
		if (!leaf) {
			// Quick Capture's two-pane layout (180px sidebar + flex-1 editor) needs real width,
			// unlike the old chat panel which lived in the narrow right sidebar -- open a leaf
			// in the main workspace area instead.
			leaf = workspace.getLeaf(true);
			await leaf.setViewState({ type: VIEW_TYPE_AI_NOTES_QUICK_CAPTURE, active: true });
		}
		workspace.revealLeaf(leaf);
	}
}
