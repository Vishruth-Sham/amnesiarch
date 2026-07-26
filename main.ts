import { Plugin, TFile, WorkspaceLeaf } from "obsidian";
import { VIEW_TYPE_AI_NOTES_CHAT } from "src/constants";
import { NoteCache } from "src/index/NoteCache";
import { VaultIndexer } from "src/index/VaultIndexer";
import { ChatView } from "src/view/ChatView";

export default class AiNotesPlugin extends Plugin {
	cache!: NoteCache;
	indexer!: VaultIndexer;

	async onload(): Promise<void> {
		this.cache = new NoteCache(this.app, this.manifest.dir ?? `.obsidian/plugins/${this.manifest.id}`);
		this.indexer = new VaultIndexer(this.app, this.cache);

		this.registerView(VIEW_TYPE_AI_NOTES_CHAT, (leaf: WorkspaceLeaf) => new ChatView(leaf, this));

		this.addRibbonIcon("message-circle", "Open AI Notes chat", () => {
			void this.activateView();
		});

		this.addCommand({
			id: "open-ai-notes-chat",
			name: "Open AI Notes chat",
			callback: () => void this.activateView(),
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
			void this.indexer.initialize().catch((e) => console.error("AI Notes: indexing failed", e));
		});
	}

	onunload(): void {
		this.app.workspace.detachLeavesOfType(VIEW_TYPE_AI_NOTES_CHAT);
	}

	async activateView(): Promise<void> {
		const { workspace } = this.app;
		let leaf = workspace.getLeavesOfType(VIEW_TYPE_AI_NOTES_CHAT)[0];
		if (!leaf) {
			leaf = workspace.getRightLeaf(false) ?? workspace.getLeaf(true);
			await leaf.setViewState({ type: VIEW_TYPE_AI_NOTES_CHAT, active: true });
		}
		workspace.revealLeaf(leaf);
	}
}
