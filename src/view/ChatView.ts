import { ItemView, WorkspaceLeaf, Notice, App, TFile, setIcon } from "obsidian";
import type AiNotesPlugin from "../../main";
import { VIEW_TYPE_AI_NOTES_CHAT, MIN_CONFIDENCE, MIN_MARGIN } from "../constants";
import { search } from "../search/HybridSearch";
import { embedText } from "../embeddings/EmbeddingModel";
import { appendToNote, copyToClipboard } from "../append/AppendService";
import { createNote, proposeTitle } from "../create/CreateNoteService";
import { SearchResult } from "../types";

const EXCERPT_CLAMP_THRESHOLD = 140; // chars; above this we offer a "Show more" toggle
const EXCERPT_TAIL_LEN = 600; // new text is appended at the end, so show context near there
const COPY_RESET_MS = 1400;

/**
 * Collapse raw LaTeX math blocks into a compact placeholder for the preview excerpt only --
 * the note on disk is never touched. A tail-sliced excerpt can start mid-formula (missing its
 * opening delimiter), so this is a best-effort cleanup, not a real LaTeX parser.
 */
function sanitizeExcerpt(text: string): string {
	return text
		.replace(/\$\$[\s\S]*?\$\$/g, " [equation] ")
		.replace(/\$[^$\n]+?\$/g, " [eq] ")
		.replace(/\s+/g, " ")
		.trim();
}

export class ChatView extends ItemView {
	private plugin: AiNotesPlugin;
	private headerBadge!: HTMLElement;
	private messagesEl!: HTMLElement;
	private composerBox!: HTMLElement;
	private inputEl!: HTMLTextAreaElement;
	private sendButton!: HTMLButtonElement;
	private chipEl: HTMLElement | null = null;
	private pendingTag: string | null = null;
	private seenNoMatchQueries = new Set<string>();

	constructor(leaf: WorkspaceLeaf, plugin: AiNotesPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_AI_NOTES_CHAT;
	}

	getDisplayText(): string {
		return "AI Notes Chat";
	}

	getIcon(): string {
		return "message-circle";
	}

	async onOpen(): Promise<void> {
		const root = this.contentEl;
		root.empty();
		root.addClass("ai-notes-view");

		this.buildHeader(root);
		this.messagesEl = root.createDiv({ cls: "ai-notes-messages" });
		this.buildComposer(root);

		this.plugin.indexer.onIndexingStart = (total) => this.setBadge(`Indexing 0/${total}…`);
		this.plugin.indexer.onProgress = (done, total) => this.setBadge(`Indexing ${done}/${total}…`);
		this.plugin.indexer.onIndexingComplete = () => this.setBadge(`${this.plugin.cache.size()} indexed`);

		this.setBadge(this.plugin.indexer.isIndexing() ? "Indexing…" : `${this.plugin.cache.size()} indexed`);
	}

	async onClose(): Promise<void> {
		this.plugin.indexer.onIndexingStart = null;
		this.plugin.indexer.onProgress = null;
		this.plugin.indexer.onIndexingComplete = null;
	}

	// ---------- header ----------

	private buildHeader(root: HTMLElement): void {
		const header = root.createDiv({ cls: "ai-notes-header" });
		const titleWrap = header.createDiv({ cls: "ai-notes-header-title" });
		titleWrap.createSpan({ cls: "ai-notes-header-name", text: "Notes assistant" });
		this.headerBadge = titleWrap.createSpan({ cls: "ai-notes-badge" });
		this.headerBadge.setAttr("role", "status");

		const clearBtn = header.createEl("button", {
			cls: "ai-notes-icon-btn",
			attr: { "aria-label": "Clear conversation", title: "Clear conversation" },
		});
		setIcon(clearBtn, "eraser");
		clearBtn.addEventListener("click", () => this.clearChat());
	}

	private setBadge(text: string): void {
		this.headerBadge.setText(text);
	}

	private clearChat(): void {
		this.messagesEl.empty();
		this.pendingTag = null;
		this.seenNoMatchQueries.clear();
		this.renderChip();
		this.inputEl.value = "";
		this.inputEl.focus();
	}

	// ---------- composer ----------

	private buildComposer(root: HTMLElement): void {
		const composer = root.createDiv({ cls: "ai-notes-composer" });
		this.composerBox = composer.createDiv({ cls: "ai-notes-composer-box" });

		this.inputEl = this.composerBox.createEl("textarea", {
			cls: "ai-notes-input",
			attr: { placeholder: "@note to target, or just start typing…", "aria-label": "Message" },
		});
		this.sendButton = this.composerBox.createEl("button", {
			cls: "ai-notes-btn ai-notes-btn--primary ai-notes-send-btn",
			attr: { "aria-label": "Send" },
			text: "Send",
		});

		composer.createDiv({
			cls: "ai-notes-help",
			text: "@ to target a note · Enter to send · Shift+Enter for newline",
		});

		this.inputEl.addEventListener("keydown", (evt: KeyboardEvent) => {
			if (evt.key === "Enter" && !evt.shiftKey) {
				evt.preventDefault();
				const value = this.inputEl.value;
				if (!this.pendingTag && value.trimStart().startsWith("@")) {
					this.confirmTag(value);
				} else {
					void this.handleSubmit();
				}
			}
		});
		this.sendButton.addEventListener("click", () => void this.handleSubmit());
	}

	/** Turn a leading "@…" in the textarea into a confirmed, highlighted tag chip. */
	private confirmTag(value: string): void {
		const tagText = value.trimStart().slice(1).trim();
		if (!tagText) return;
		this.pendingTag = tagText;
		this.inputEl.value = "";
		this.renderChip();
	}

	private renderChip(): void {
		this.chipEl?.remove();
		this.chipEl = null;
		if (!this.pendingTag) return;

		const chip = createDiv({ cls: "ai-notes-tag-chip" });
		chip.createSpan({ text: `@${this.pendingTag}` });
		const remove = chip.createEl("button", {
			cls: "ai-notes-tag-chip-remove",
			attr: { "aria-label": `Remove @${this.pendingTag} target` },
			text: "×",
		});
		remove.addEventListener("click", () => {
			this.pendingTag = null;
			this.renderChip();
			this.inputEl.focus();
		});
		this.composerBox.insertBefore(chip, this.inputEl);
		this.chipEl = chip;
	}

	// ---------- submit ----------

	private async handleSubmit(): Promise<void> {
		const noteText = this.inputEl.value.trim();
		if (!noteText) return;

		const tagQuery = this.pendingTag;
		this.inputEl.value = "";
		this.pendingTag = null;
		this.renderChip();
		this.setComposerBusy(true);

		this.messagesEl.createDiv({
			cls: "ai-notes-msg ai-notes-msg--user",
			text: tagQuery ? `@${tagQuery}\n${noteText}` : noteText,
		});

		try {
			const queryText = tagQuery ?? noteText;
			const queryVec = await embedText(queryText);
			const weights = this.plugin.profileCache.getWeights();
			const results = search(queryVec, queryText, this.plugin.cache.getAll(), weights);

			const wrap = this.messagesEl.createDiv({ cls: "ai-notes-msg ai-notes-msg--assistant" });
			this.renderResult(wrap, noteText, queryText, results, 0, tagQuery !== null, false);
		} catch (e) {
			console.error("AI Notes: search failed", e);
			new Notice("AI Notes: something went wrong during search — see console for details.");
		} finally {
			this.setComposerBusy(false);
			this.inputEl.focus();
			this.messagesEl.scrollTo({ top: this.messagesEl.scrollHeight });
		}
	}

	private setComposerBusy(busy: boolean): void {
		this.inputEl.disabled = busy;
		this.sendButton.disabled = busy;
		if (busy) this.sendButton.setAttr("data-state", "loading");
		else this.sendButton.removeAttribute("data-state");
	}

	// ---------- result rendering ----------

	private renderResult(
		container: HTMLElement,
		appendText: string,
		queryText: string,
		results: SearchResult[],
		selectedIndex: number,
		usedTag: boolean,
		forceAccept: boolean,
	): void {
		container.empty();

		const top = results[selectedIndex];
		if (!top) {
			this.renderEmptyState(container, appendText);
			return;
		}

		// forceAccept covers every path where the user already made an explicit choice --
		// "Use closest", an alternate chip, or a pick from the ambiguous list below. Once picked,
		// always render as a confident match: re-running the margin check against the same
		// results would be nonsensical (the user just resolved the ambiguity themselves).
		if (forceAccept) {
			this.renderMatch(container, appendText, top, results, selectedIndex, usedTag);
			return;
		}

		if (top.score < MIN_CONFIDENCE) {
			this.renderNoMatch(container, appendText, queryText, top, results, usedTag);
			return;
		}

		// Margin between #1 and #2, not an absolute score cutoff: raw cosine-score distributions
		// shift with corpus size, so a fixed threshold means something different at 200 notes
		// than at 20,000. The margin directly asks "is there a clear winner?" (see MIN_MARGIN's
		// definition in constants.ts / plans/v2-scale-first.md §4 Phase 4).
		const second = results[1];
		const margin = second ? top.score - second.score : Infinity;
		if (results.length > 1 && margin < MIN_MARGIN) {
			this.renderAmbiguous(container, appendText, queryText, results, usedTag);
			return;
		}

		this.renderMatch(container, appendText, top, results, selectedIndex, usedTag);
	}

	private renderAmbiguous(
		container: HTMLElement,
		appendText: string,
		queryText: string,
		results: SearchResult[],
		usedTag: boolean,
	): void {
		container.addClass("ai-notes-result", "ai-notes-result--ambiguous");

		const head = container.createDiv({ cls: "ai-notes-result-head-compact" });
		const icon = head.createSpan({ cls: "ai-notes-inline-icon" });
		setIcon(icon, "list");
		head.createSpan({ text: "A few notes could fit — pick one" });

		const list = container.createDiv({ cls: "ai-notes-ambiguous-list" });
		for (const result of results.slice(0, 3)) {
			const idx = results.indexOf(result);
			const row = list.createEl("button", {
				cls: "ai-notes-ambiguous-row",
				attr: { title: result.entry.path },
			});
			row.createSpan({ cls: "ai-notes-ambiguous-title", text: result.entry.title });
			row.createSpan({ cls: "ai-notes-badge ai-notes-badge--muted", text: `${Math.round(result.score * 100)}%` });
			row.addEventListener("click", () => {
				this.renderResult(container, appendText, queryText, results, idx, usedTag, true);
			});
		}

		const actions = container.createDiv({ cls: "ai-notes-actions" });
		this.renderCreateNoteAction(actions, container, appendText);
		this.createCopyButton(actions, appendText, "Copy");
	}

	private renderEmptyState(container: HTMLElement, appendText: string): void {
		container.addClass("ai-notes-result", "ai-notes-result--nomatch");
		container.createDiv({ cls: "ai-notes-result-head-compact", text: "No notes indexed yet" });
		const actions = container.createDiv({ cls: "ai-notes-actions" });
		this.createCopyButton(actions, appendText, "Copy");
	}

	private renderNoMatch(
		container: HTMLElement,
		appendText: string,
		queryText: string,
		top: SearchResult,
		results: SearchResult[],
		usedTag: boolean,
	): void {
		container.addClass("ai-notes-result", "ai-notes-result--nomatch");

		const head = container.createDiv({ cls: "ai-notes-result-head-compact" });
		const icon = head.createSpan({ cls: "ai-notes-inline-icon" });
		setIcon(icon, "search-x");
		head.createSpan({ text: "No confident match" });

		const meta = container.createDiv({ cls: "ai-notes-result-meta" });
		meta.createSpan({ text: "Closest: " });
		meta.createEl("code", { cls: "ai-notes-note-chip", text: top.entry.title });
		meta.createSpan({ text: ` · ${Math.round(top.score * 100)}%` });

		const alreadySeen = this.seenNoMatchQueries.has(queryText);
		this.seenNoMatchQueries.add(queryText);
		if (!usedTag && !alreadySeen) {
			container.createDiv({
				cls: "ai-notes-tip",
				text: "Tip: start with @ followed by a project name or description to point me at the right note.",
			});
		}

		const actions = container.createDiv({ cls: "ai-notes-actions" });
		const useClosest = actions.createEl("button", { cls: "ai-notes-btn ai-notes-btn--secondary", text: "Use closest" });
		useClosest.addEventListener("click", () => {
			this.renderResult(container, appendText, queryText, results, 0, usedTag, true);
		});
		this.renderCreateNoteAction(actions, container, appendText);
		this.createCopyButton(actions, appendText, "Copy");
	}

	// ---------- create-new-note flow (Phase 4: "no match" is a real outcome, not a dead end) ----------

	private renderCreateNoteAction(actions: HTMLElement, container: HTMLElement, appendText: string): void {
		const createBtn = actions.createEl("button", { cls: "ai-notes-btn ai-notes-btn--ghost", text: "Create new note" });
		createBtn.addEventListener("click", () => {
			createBtn.remove();
			this.renderCreateNoteForm(container, appendText);
		});
	}

	/** Proposes a title but never creates anything without an explicit confirm click on the
	 *  (editable) title the user actually sees -- generating a title is new content, and the
	 *  append-text invariant (CLAUDE.md) means automation should never silently write something
	 *  the user didn't approve. */
	private renderCreateNoteForm(container: HTMLElement, appendText: string): void {
		const form = container.createDiv({ cls: "ai-notes-create-form" });
		const input = form.createEl("input", {
			cls: "ai-notes-create-title-input",
			attr: { type: "text", "aria-label": "New note title" },
		});
		input.value = proposeTitle(appendText);

		const formActions = form.createDiv({ cls: "ai-notes-actions" });
		const confirmBtn = formActions.createEl("button", { cls: "ai-notes-btn ai-notes-btn--primary", text: "Create" });
		const cancelBtn = formActions.createEl("button", { cls: "ai-notes-btn ai-notes-btn--ghost", text: "Cancel" });

		const submit = async () => {
			const title = input.value.trim();
			if (!title) {
				input.focus();
				return;
			}
			confirmBtn.disabled = true;
			cancelBtn.disabled = true;
			confirmBtn.setAttr("data-state", "loading");
			confirmBtn.setText("Creating…");
			try {
				const file = await createNote(this.plugin.app, title, appendText);
				form.empty();
				const done = form.createDiv({ cls: "ai-notes-done" });
				const check = done.createSpan({ cls: "ai-notes-inline-icon" });
				setIcon(check, "check");
				done.createSpan({ text: `Created ${file.basename}` });
			} catch (e) {
				console.error("AI Notes: failed to create note", e);
				confirmBtn.disabled = false;
				cancelBtn.disabled = false;
				confirmBtn.removeAttribute("data-state");
				confirmBtn.setText("Create");
				new Notice("AI Notes: couldn't create the note — see console for details.");
			}
		};

		confirmBtn.addEventListener("click", () => void submit());
		cancelBtn.addEventListener("click", () => form.remove());
		input.addEventListener("keydown", (evt: KeyboardEvent) => {
			if (evt.key === "Enter") {
				evt.preventDefault();
				void submit();
			}
		});

		input.focus();
		input.select();
	}

	private renderMatch(
		container: HTMLElement,
		appendText: string,
		top: SearchResult,
		results: SearchResult[],
		selectedIndex: number,
		usedTag: boolean,
	): void {
		container.addClass("ai-notes-result", "ai-notes-result--match");

		const head = container.createDiv({ cls: "ai-notes-result-head" });
		head.createSpan({ cls: "ai-notes-result-title", text: top.entry.title, attr: { title: top.entry.path } });
		head.createSpan({ cls: "ai-notes-badge ai-notes-badge--muted", text: `${Math.round(top.score * 100)}% match` });

		this.renderExcerpt(container, top.entry.path);

		const diff = container.createDiv({ cls: "ai-notes-diff" });
		diff.createDiv({ cls: "ai-notes-diff-label", text: "Proposed addition" });
		diff.createDiv({ cls: "ai-notes-diff-line", text: `+ ${appendText}` });

		const actions = container.createDiv({ cls: "ai-notes-actions" });
		const acceptBtn = actions.createEl("button", { cls: "ai-notes-btn ai-notes-btn--primary", text: "Add to note" });
		const declineBtn = actions.createEl("button", { cls: "ai-notes-btn ai-notes-btn--secondary", text: "Copy instead" });

		acceptBtn.addEventListener("click", async () => {
			acceptBtn.disabled = true;
			declineBtn.disabled = true;
			acceptBtn.setAttr("data-state", "loading");
			acceptBtn.setText("Adding…");
			try {
				await appendToNote(this.plugin.app, top.entry.path, appendText);
				actions.empty();
				const done = actions.createDiv({ cls: "ai-notes-done" });
				const check = done.createSpan({ cls: "ai-notes-inline-icon" });
				setIcon(check, "check");
				done.createSpan({ text: `Added to ${top.entry.title}` });
			} catch (e) {
				console.error("AI Notes: append failed", e);
				acceptBtn.disabled = false;
				declineBtn.disabled = false;
				acceptBtn.setAttr("data-state", "error");
				acceptBtn.setText("Try again");
			}
		});

		declineBtn.addEventListener("click", () => this.wireCopyBehavior(declineBtn, appendText, "Copy instead"));

		const alternates = results.filter((_, i) => i !== selectedIndex);
		if (alternates.length > 0) {
			const altsEl = container.createDiv({ cls: "ai-notes-alts" });
			altsEl.createSpan({ cls: "ai-notes-alts-label", text: "Choose another note:" });
			for (const alt of alternates) {
				const idx = results.indexOf(alt);
				const chip = altsEl.createEl("button", {
					cls: "ai-notes-chip-btn",
					text: alt.entry.title,
					attr: { title: alt.entry.path },
				});
				chip.addEventListener("click", () => {
					this.renderResult(container, appendText, "", results, idx, usedTag, true);
				});
			}
		}
	}

	private renderExcerpt(container: HTMLElement, path: string): void {
		const excerptEl = container.createDiv({ cls: "ai-notes-result-excerpt" });
		void this.readTailSnippet(this.plugin.app, path).then(({ text: raw, truncated }) => {
			if (!raw) {
				excerptEl.remove();
				return;
			}
			const snippet = sanitizeExcerpt(raw);
			excerptEl.setText(truncated ? `…${snippet}` : snippet);
			if (snippet.length > EXCERPT_CLAMP_THRESHOLD) {
				excerptEl.addClass("is-clamped");
				const toggle = container.createEl("button", {
					cls: "ai-notes-expand-btn",
					text: "Show more",
					attr: { "aria-expanded": "false" },
				});
				container.insertAfter(toggle, excerptEl);
				toggle.addEventListener("click", () => {
					const expanded = excerptEl.hasClass("is-clamped");
					excerptEl.toggleClass("is-clamped", !expanded);
					toggle.setText(expanded ? "Show more" : "Show less");
					toggle.setAttr("aria-expanded", String(expanded));
				});
			}
		});
	}

	// ---------- shared action helpers ----------

	private createCopyButton(actions: HTMLElement, text: string, label: string): HTMLButtonElement {
		const btn = actions.createEl("button", { cls: "ai-notes-btn ai-notes-btn--ghost", text: label });
		btn.addEventListener("click", () => this.wireCopyBehavior(btn, text, label));
		return btn;
	}

	private wireCopyBehavior(btn: HTMLButtonElement, text: string, restingLabel: string): void {
		void copyToClipboard(text).then(() => {
			btn.setAttr("data-state", "success");
			btn.setText("Copied");
			window.setTimeout(() => {
				btn.removeAttribute("data-state");
				btn.setText(restingLabel);
			}, COPY_RESET_MS);
		});
	}

	private async readTailSnippet(app: App, path: string): Promise<{ text: string; truncated: boolean }> {
		const file = app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) return { text: "", truncated: false };
		try {
			const content = await app.vault.cachedRead(file);
			const trimmed = content.trim();
			const truncated = trimmed.length > EXCERPT_TAIL_LEN;
			return { text: truncated ? trimmed.slice(-EXCERPT_TAIL_LEN) : trimmed, truncated };
		} catch {
			return { text: "", truncated: false };
		}
	}
}
