import { Notice, Plugin, TFile, WorkspaceLeaf } from "obsidian";
import { VIEW_TYPE_AMNESIARCH_QUICK_CAPTURE, LEGACY_VIEW_TYPE_AMNESIARCH_CHAT } from "src/constants";
import { NoteCache } from "src/index/NoteCache";
import { VaultIndexer } from "src/index/VaultIndexer";
import { AmnesiarchSettings, DEFAULT_SETTINGS } from "src/settings/Settings";
import { AmnesiarchSettingsTab } from "src/settings/SettingsTab";
import { ProfileCache } from "src/search/ProfileCache";
import { QuickCaptureView } from "src/view/QuickCaptureView";

export default class AmnesiarchPlugin extends Plugin {
	cache!: NoteCache;
	indexer!: VaultIndexer;
	profileCache!: ProfileCache;
	settings!: AmnesiarchSettings;

	async onload(): Promise<void> {
		// loadData() is typed Promise<any> by the Obsidian API -- narrow it to this plugin's own
		// settings shape (the only thing ever saved via saveSettings()) rather than letting `any`
		// flow into `this.settings`'s assignment.
		const savedData = (await this.loadData()) as Partial<AmnesiarchSettings> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, savedData ?? {});

		this.cache = new NoteCache(this.app, this.manifest.dir ?? `.obsidian/plugins/${this.manifest.id}`);
		this.indexer = new VaultIndexer(this.app, this.cache, () => this.settings.excludePatterns);
		this.profileCache = new ProfileCache(this.cache);

		this.addSettingTab(new AmnesiarchSettingsTab(this.app, this));

		this.registerView(VIEW_TYPE_AMNESIARCH_QUICK_CAPTURE, (leaf: WorkspaceLeaf) => new QuickCaptureView(leaf, this));

		this.addRibbonIcon("inbox", "Open Quick Capture", () => {
			void this.activateView();
		});

		this.addCommand({
			id: "open-quick-capture",
			name: "Open Quick Capture",
			callback: () => void this.activateView(),
		});

		this.addCommand({
			id: "rebuild-index",
			name: "Rebuild index",
			callback: () => {
				new Notice("Amnesiarch: rebuilding index from scratch…");
				void this.indexer.rebuildAll().then(() => new Notice(`Amnesiarch: rebuilt (${this.cache.size()} notes indexed).`));
			},
		});

		this.addCommand({
			id: "show-vault-profile",
			name: "Show vault profile (debug)",
			callback: () => {
				const profile = this.profileCache.getProfile();
				const weights = this.profileCache.getWeights();
				if (!profile) {
					new Notice("Amnesiarch: no notes indexed yet.");
					return;
				}
				// Debug-only, user-triggered command (never automatic/background logging). The
				// Notice below already surfaces noteCount and the three structural weights, so
				// only the full profile object -- which also has tagCoverage/folderBranching/
				// linkDensity/titleInformativeness that the Notice doesn't -- is worth the extra
				// console.log; a second log of `weights` alone would just repeat the Notice.
				console.log("Amnesiarch: vault profile", profile);
				new Notice(
					`Amnesiarch vault profile (full detail in console):\n` +
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
			this.app.workspace.detachLeavesOfType(LEGACY_VIEW_TYPE_AMNESIARCH_CHAT);
			void this.indexer.initialize().catch((e) => console.error("Amnesiarch: indexing failed", e));
		});
	}

	onunload(): void {
		// Deliberately does NOT detachLeavesOfType() here -- doing so in onunload() resets the
		// leaf to its default location the next time the plugin loads, even if the user had moved
		// it elsewhere (Obsidian plugin guidelines). Any open Quick Capture leaf is simply left as
		// an orphaned view when the plugin unloads/disables/updates, same as most other plugins.
		//
		// Flush any pending debounced cache write (NoteCache.scheduleSave()) immediately rather
		// than losing up to CACHE_SAVE_DEBOUNCE_MS of indexing progress on quit/disable.
		void this.cache.flush().catch((e) => console.error("Amnesiarch: failed to flush cache on unload", e));
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	async activateView(): Promise<void> {
		const { workspace } = this.app;
		let leaf = workspace.getLeavesOfType(VIEW_TYPE_AMNESIARCH_QUICK_CAPTURE)[0];
		if (!leaf) {
			// Quick Capture's two-pane layout (180px sidebar + flex-1 editor) needs real width,
			// unlike the old chat panel which lived in the narrow right sidebar -- open a leaf
			// in the main workspace area instead.
			leaf = workspace.getLeaf(true);
			await leaf.setViewState({ type: VIEW_TYPE_AMNESIARCH_QUICK_CAPTURE, active: true });
		}
		// setActiveLeaf() (not revealLeaf(), which needs Obsidian 1.7.2) -- Quick Capture always
		// opens in the main workspace area, never a collapsible sidebar (see the comment above),
		// so revealLeaf()'s extra "uncollapse the sidebar" behavior doesn't apply here; bringing
		// the leaf to the front and focusing it is all this actually needs.
		workspace.setActiveLeaf(leaf, { focus: true });
	}
}
