import { ItemView, WorkspaceLeaf, Notice, TFile } from "obsidian";
import type AiNotesPlugin from "../../main";
import { VIEW_TYPE_AI_NOTES_QUICK_CAPTURE, MIN_CONFIDENCE, MIN_MARGIN } from "../constants";
import { search } from "../search/HybridSearch";
import { embedText } from "../embeddings/EmbeddingModel";
import { appendToNote } from "../append/AppendService";
import { createNote, proposeTitle } from "../create/CreateNoteService";
import { rankNoteMetadata, NotePickerItem } from "../search/NotePicker";
import { SearchResult } from "../types";

/** Sentinel activeNoteId for the (non-persisted) Quick Capture pane -- see README's
 *  "State Management" section in design_handoff_ai_quick_capture/. */
const QUICK_CAPTURE_ID = "quick-capture";

const EXCERPT_TAIL_LEN = 600; // new text is appended at the end, so show context near there

type Phase = "match" | "ambiguous" | "create";

interface SidebarNote {
	path: string;
	title: string;
}

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

/**
 * Check only the file's actual append boundary -- `appendToNote()` always writes at the tail,
 * so the just-filed block can only ever legitimately be the last N lines. A single tail check,
 * not a backward scan: if an older duplicate of the same text exists earlier in the note (or
 * the fresh block was itself edited/removed after filing), this must render no highlight
 * rather than highlighting that older, no-longer-relevant occurrence (review correction #7).
 */
function findHighlightRange(lines: string[], appended: string): [number, number] | null {
	const appendedLines = appended.split("\n").filter((l) => l.trim().length > 0);
	if (appendedLines.length === 0) return null;
	const start = lines.length - appendedLines.length;
	if (start < 0) return null;
	for (let j = 0; j < appendedLines.length; j++) {
		if (lines[start + j] !== appendedLines[j]) return null;
	}
	return [start, start + appendedLines.length - 1];
}

/**
 * "AI Quick Capture" -- replaces the old sidebar chat panel (ChatView, removed) with an
 * in-note routing UI: the user writes an untitled thought in a plain textarea, "Sort this
 * note" proposes a destination (confident append / ambiguous pick / create new), and jumps
 * them to the result. See design_handoff_ai_quick_capture/README.md for the full spec this
 * view was built against; all matching/append/create logic below is reused from the existing
 * backend services unchanged.
 */
export class QuickCaptureView extends ItemView {
	private plugin: AiNotesPlugin;

	// ---- view-local state (design handoff README "State Management") ----
	private activeNoteId: string = QUICK_CAPTURE_ID;
	private draftText = "";
	private sorted = false;
	private forceCreate = false;
	private newTitleOverride = "";
	/** Session-accumulated: notes jumped to or filed into this session, most-recent first.
	 *  Deliberately NOT the whole vault -- see CLAUDE.md / implementation brief decision #3. */
	private sidebarNotes: SidebarNote[] = [];
	/** Last text filed into each note, so the destination-note render can highlight it. */
	private filedHighlights = new Map<string, string>();
	private lastResults: SearchResult[] | null = null;

	// ---- manual "Search notes instead" picker state (view-local, decision-card-scoped) ----
	private isNotePickerOpen = false;
	private notePickerQuery = "";
	private notePickerResults: NotePickerItem[] = [];
	private highlightedResultIndex = -1;
	/** Set once the user clicks/selects a manual result, pending the Add-and-jump / Add-and-
	 *  stay-here choice -- kept separate from `lastResults` because a manual pick is not an
	 *  embedding SearchResult and must never carry a fabricated semantic score. */
	private notePickerSelection: NotePickerItem | null = null;

	private sidebarEl!: HTMLElement;
	private mainEl!: HTMLElement;
	/** The currently-mounted Quick Capture draft textarea, if the Quick Capture pane is the
	 *  active view (null otherwise). Operation handlers snapshot this reference locally before
	 *  an await, rather than re-reading `this.draftTextarea` afterward, so a navigate-away
	 *  during a pending operation can never toggle `.disabled` on an unrelated, later-mounted
	 *  textarea. */
	private draftTextarea: HTMLTextAreaElement | null = null;
	/** Guards against overlapping Sort/Add/Create requests; all three are mutually exclusive
	 *  from the UI at any given moment. */
	private busy = false;

	constructor(leaf: WorkspaceLeaf, plugin: AiNotesPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_AI_NOTES_QUICK_CAPTURE;
	}

	getDisplayText(): string {
		return "Quick Capture";
	}

	getIcon(): string {
		return "inbox";
	}

	async onOpen(): Promise<void> {
		const root = this.contentEl;
		root.empty();
		root.addClass("ai-quickcap-view");

		const shell = root.createDiv({ cls: "ai-quickcap-shell" });
		this.sidebarEl = shell.createDiv({ cls: "ai-quickcap-sidebar" });
		this.mainEl = shell.createDiv({ cls: "ai-quickcap-main" });

		this.render();
	}

	async onClose(): Promise<void> {
		// No indexer callbacks are wired here (unlike the old ChatView's header badge) -- nothing to tear down.
	}

	// ---------- state transition helpers ----------

	private resetDecision(): void {
		this.sorted = false;
		this.forceCreate = false;
		this.lastResults = null;
		// A title typed for one draft must never survive to seed the create card for a later,
		// different draft (review correction #4) -- renderCreateCard's `proposeTitle(draftText)`
		// fallback only kicks in once this is empty again.
		this.newTitleOverride = "";
		this.resetNotePicker();
	}

	/** Clears only the manual-search UI, leaving the AI decision (sorted/forceCreate/
	 *  lastResults) and the draft untouched -- closing the picker must not dismiss the
	 *  decision it was opened from. */
	private resetNotePicker(): void {
		this.isNotePickerOpen = false;
		this.notePickerQuery = "";
		this.notePickerResults = [];
		this.highlightedResultIndex = -1;
		this.notePickerSelection = null;
	}

	private touchSidebarNote(path: string, title: string): void {
		this.sidebarNotes = this.sidebarNotes.filter((n) => n.path !== path);
		this.sidebarNotes.unshift({ path, title });
	}

	private computePhase(results: SearchResult[]): Phase {
		const top = results[0];
		// Folds the "no notes indexed yet" case into the same "create" card as a genuine
		// no-confident-match: there's nothing to append to either way, and Phase 4 already
		// established that "no match" should offer note creation rather than dead-ending
		// (see ChatView.renderResult, ported here unchanged apart from that fold-in).
		if (!top || top.score < MIN_CONFIDENCE) return "create";
		const second = results[1];
		const margin = second ? top.score - second.score : Infinity;
		if (results.length > 1 && margin < MIN_MARGIN) return "ambiguous";
		return "match";
	}

	// ---------- render: top level ----------

	private render(): void {
		this.renderSidebar();
		this.renderMain();
	}

	private renderSidebar(): void {
		this.sidebarEl.empty();
		this.sidebarEl.createDiv({ cls: "ai-quickcap-sidebar-label", text: "Notes" });

		const navItems: SidebarNote[] = [{ path: QUICK_CAPTURE_ID, title: "Quick Capture" }, ...this.sidebarNotes];
		for (const item of navItems) {
			const active = item.path === this.activeNoteId;
			const row = this.sidebarEl.createEl("button", {
				cls: "ai-quickcap-nav-row" + (active ? " is-active" : ""),
				text: item.title,
				attr: { type: "button", title: item.title },
			});
			row.addEventListener("click", () => {
				if (this.activeNoteId === item.path) return;
				this.activeNoteId = item.path;
				this.render();
			});
		}
	}

	private renderMain(): void {
		this.mainEl.empty();
		const isQuickCapture = this.activeNoteId === QUICK_CAPTURE_ID;
		const title = isQuickCapture
			? "Quick Capture"
			: (this.sidebarNotes.find((n) => n.path === this.activeNoteId)?.title ?? this.activeNoteId);
		this.mainEl.createDiv({ cls: "ai-quickcap-title", text: title });

		if (isQuickCapture) {
			this.renderQuickCapture();
		} else {
			this.draftTextarea = null;
			void this.renderDestinationNote(this.activeNoteId);
		}
	}

	// ---------- Quick Capture pane ----------

	private renderQuickCapture(): void {
		const body = this.mainEl.createDiv({ cls: "ai-quickcap-body" });

		const textarea = body.createEl("textarea", {
			cls: "ai-quickcap-textarea",
			attr: { placeholder: "Write a quick note — sort it after.", "aria-label": "Quick capture note" },
		});
		textarea.value = this.draftText;
		textarea.disabled = this.busy;
		this.draftTextarea = textarea;

		const footerEl = body.createDiv({ cls: "ai-quickcap-footer" });

		// Editing text always resets any pending routing decision (design handoff README
		// "Interactions & Behavior"). The textarea element itself is never recreated here, so
		// the user's cursor position is untouched -- only the footer below it re-renders.
		textarea.addEventListener("input", () => {
			this.draftText = textarea.value;
			this.resetDecision();
			this.renderFooter(footerEl);
		});

		this.renderFooter(footerEl);
		textarea.focus();
	}

	private renderFooter(footerEl: HTMLElement): void {
		footerEl.empty();
		const hasText = this.draftText.trim().length > 0;

		if (!hasText) {
			return;
		}
		if (!this.sorted) {
			this.renderSortButton(footerEl);
			return;
		}
		if (this.forceCreate) {
			// "+ New note instead" from the ambiguous card -- there was a match, just not a clear
			// one; keep its existing copy, not the empty-index framing below.
			this.renderCreateCard(footerEl, "low-confidence");
			return;
		}
		const results = this.lastResults ?? [];
		const phase = this.computePhase(results);
		if (phase === "create") {
			// results.length === 0 can only happen if the cache itself was empty when Sort ran
			// (search() maps over plugin.cache.getAll() 1:1) -- that's a coverage gap, not a
			// considered "no confident match" judgment, and must say so (review correction #5).
			this.renderCreateCard(footerEl, results.length === 0 ? "empty-index" : "low-confidence");
		} else if (phase === "ambiguous") this.renderAmbiguousCard(footerEl, results);
		else this.renderMatchCard(footerEl, results);
	}

	private renderSortButton(footerEl: HTMLElement): void {
		const row = footerEl.createDiv({ cls: "ai-quickcap-sort-row" });
		const btn = row.createEl("button", { cls: "ai-quickcap-btn ai-quickcap-btn--sort", text: "Sort this note" });
		btn.addEventListener("click", () => void this.handleSort(btn, footerEl));
	}

	private async handleSort(btn: HTMLButtonElement, footerEl: HTMLElement): Promise<void> {
		if (this.busy) return;
		this.busy = true;
		// Exact-snapshot guard (review correction #1): even though the textarea below is also
		// disabled for the duration of this call -- belt-and-suspenders against installing a
		// decision computed for text the user has since changed. embedText/search take real time
		// (model warm-up especially), so this window is not hypothetical.
		const draftAtSort = this.draftText;
		const textareaAtStart = this.draftTextarea;
		btn.disabled = true;
		if (textareaAtStart) textareaAtStart.disabled = true;
		btn.setText("Sorting…");
		try {
			const queryText = draftAtSort.trim();
			const queryVec = await embedText(queryText);
			const weights = this.plugin.profileCache.getWeights();
			const results = search(queryVec, queryText, this.plugin.cache.getAll(), weights);
			if (this.draftText !== draftAtSort) {
				// The draft changed while this Sort was in flight -- a destination computed for
				// the old text must never be shown against the new text. Silently discard; the
				// footer re-render below already reflects whatever the current draft/decision
				// state actually is (the edit's own input handler already reset it).
				return;
			}
			this.lastResults = results;
			this.sorted = true;
			this.forceCreate = false;
		} catch (e) {
			console.error("AI Notes: search failed", e);
			new Notice("AI Notes: something went wrong during search — see console for details.");
		} finally {
			this.busy = false;
			if (textareaAtStart) textareaAtStart.disabled = false;
			// On failure/staleness `sorted` stays false, so this naturally re-renders a fresh,
			// retryable Sort button rather than getting stuck in a "Sorting…" state.
			this.renderFooter(footerEl);
		}
	}

	// ---------- decision cards ----------

	/** A quiet, minimal warning shown on any decision card while the vault index is still
	 *  building (review correction #5) -- read synchronously from the existing
	 *  `indexer.isIndexing()` at render time, not a new indexer-event subscription. */
	private renderIndexingHint(card: HTMLElement): void {
		if (!this.plugin.indexer.isIndexing()) return;
		card.createDiv({
			cls: "ai-quickcap-card-hint",
			text: "Index is still building — results may be incomplete.",
		});
	}

	private renderMatchCard(footerEl: HTMLElement, results: SearchResult[]): void {
		const top = results[0];
		const card = footerEl.createDiv({ cls: "ai-quickcap-card" });

		const head = card.createDiv({ cls: "ai-quickcap-card-head" });
		head.createSpan({ cls: "ai-quickcap-card-title", text: top.entry.title, attr: { title: top.entry.path } });
		head.createSpan({ cls: "ai-quickcap-badge", text: `${Math.round(top.score * 100)}% match` });

		this.renderIndexingHint(card);

		const excerptEl = card.createDiv({ cls: "ai-quickcap-excerpt" });
		void this.loadExcerpt(top.entry.path).then((snippet) => {
			if (snippet) excerptEl.setText(snippet);
			else excerptEl.remove();
		});

		const actions = card.createDiv({ cls: "ai-quickcap-actions" });
		const addJumpBtn = actions.createEl("button", { cls: "ai-quickcap-btn ai-quickcap-btn--primary", text: "Add and jump" });
		const addStayBtn = actions.createEl("button", {
			cls: "ai-quickcap-btn ai-quickcap-btn--secondary",
			text: "Add and stay here",
		});
		const keepEditingBtn = actions.createEl("button", { cls: "ai-quickcap-btn ai-quickcap-btn--ghost", text: "Keep editing" });

		const buttons = [addJumpBtn, addStayBtn, keepEditingBtn];
		addJumpBtn.addEventListener("click", () => void this.handleAdd(top.entry.path, top.entry.title, true, buttons));
		addStayBtn.addEventListener("click", () => void this.handleAdd(top.entry.path, top.entry.title, false, buttons));
		keepEditingBtn.addEventListener("click", () => {
			this.resetDecision();
			this.renderFooter(footerEl);
		});

		this.renderNotePickerSection(card, footerEl);
	}

	private renderAmbiguousCard(footerEl: HTMLElement, results: SearchResult[]): void {
		const card = footerEl.createDiv({ cls: "ai-quickcap-card" });
		card.createDiv({ cls: "ai-quickcap-card-copy", text: "A few notes could match — pick one" });

		this.renderIndexingHint(card);

		const candidates = results.slice(0, 3);
		const list = card.createDiv({ cls: "ai-quickcap-candidate-list" });
		const rows: HTMLButtonElement[] = candidates.map((result) => {
			const row = list.createEl("button", {
				cls: "ai-quickcap-candidate-row",
				attr: { type: "button", title: result.entry.path },
			});
			row.createSpan({ cls: "ai-quickcap-candidate-title", text: result.entry.title });
			row.createSpan({ cls: "ai-quickcap-badge", text: `${Math.round(result.score * 100)}%` });
			return row;
		});

		this.renderNotePickerSection(card, footerEl);

		const actions = card.createDiv({ cls: "ai-quickcap-actions" });
		const newNoteBtn = actions.createEl("button", {
			cls: "ai-quickcap-btn ai-quickcap-btn--secondary ai-quickcap-btn--fill",
			text: "+ New note instead",
		});
		const keepEditingBtn = actions.createEl("button", { cls: "ai-quickcap-btn ai-quickcap-btn--ghost", text: "Keep editing" });

		// All rows and both actions are disabled together while any one candidate's append is in
		// flight -- otherwise "+ New note instead"/"Keep editing" could fire mid-write and have
		// their effect silently discarded once the original append's resetDecision() runs
		// (review correction #1: "all controls relevant to ... Add" while an operation is busy).
		const allControls = [...rows, newNoteBtn, keepEditingBtn];
		candidates.forEach((result, i) => {
			rows[i].addEventListener("click", () => void this.handleAdd(result.entry.path, result.entry.title, true, allControls));
		});

		newNoteBtn.addEventListener("click", () => {
			this.forceCreate = true;
			this.newTitleOverride = proposeTitle(this.draftText);
			// Swapping to the create card replaces the active decision without going through
			// resetDecision() (sorted/lastResults must survive so "Back" can return here) -- the
			// picker itself still needs a fresh start under the new card, though.
			this.resetNotePicker();
			this.renderFooter(footerEl);
		});
		keepEditingBtn.addEventListener("click", () => {
			this.resetDecision();
			this.renderFooter(footerEl);
		});
	}

	private renderCreateCard(footerEl: HTMLElement, reason: "empty-index" | "low-confidence"): void {
		const card = footerEl.createDiv({ cls: "ai-quickcap-card" });

		// Zero results means the cache was empty when Sort ran (search() maps 1:1 over
		// plugin.cache.getAll()) -- that's a coverage gap, never a considered judgment that
		// nothing matched, and must be described honestly rather than as "no confident match"
		// (review correction #5).
		if (reason === "empty-index") {
			const copy = this.plugin.indexer.isIndexing()
				? "Still indexing — no notes to compare yet"
				: "No notes indexed yet — new note";
			card.createDiv({ cls: "ai-quickcap-card-copy", text: copy });
		} else {
			card.createDiv({ cls: "ai-quickcap-card-copy", text: "No confident match — new note" });
			// Already covered by the "Still indexing…" copy above when reason is "empty-index" --
			// only add the separate hint here so the two messages don't say the same thing twice.
			this.renderIndexingHint(card);
		}

		const input = card.createEl("input", {
			cls: "ai-quickcap-title-input",
			attr: { type: "text", "aria-label": "New note title" },
		});
		input.value = this.newTitleOverride || proposeTitle(this.draftText);
		input.addEventListener("input", () => {
			this.newTitleOverride = input.value;
		});

		const actions = card.createDiv({ cls: "ai-quickcap-actions" });
		const createBtn = actions.createEl("button", { cls: "ai-quickcap-btn ai-quickcap-btn--primary", text: "Create and jump" });
		const backBtn = actions.createEl("button", { cls: "ai-quickcap-btn ai-quickcap-btn--ghost", text: "Back" });

		createBtn.addEventListener("click", () => void this.handleCreate(input, [createBtn, backBtn]));
		// Matches the design prototype's onBackFromCreate exactly: always clears back to plain
		// editing (sorted:false, forceCreate:false), not conditionally back to the ambiguous list.
		backBtn.addEventListener("click", () => {
			this.resetDecision();
			this.renderFooter(footerEl);
		});

		this.renderNotePickerSection(card, footerEl);

		// Don't steal focus from an already-open picker's own search input (renderNotePickerSection
		// above already focused it) -- only claim it here on the card's own initial render.
		if (!this.isNotePickerOpen) {
			input.focus();
			input.select();
		}
	}

	// ---------- action handlers (shared backend calls) ----------

	/**
	 * Append-text invariant (CLAUDE.md): `textToFile` is passed to `appendToNote()` completely
	 * unmodified -- no `.trim()`. The textarea is disabled for the duration of the write so the
	 * user cannot edit mid-flight; `this.draftText === textToFile` is then re-checked before
	 * clearing the draft as defense-in-depth against that same class of stale-write bug (review
	 * correction #1/#3), even though disabling already makes a mismatch unreachable today.
	 */
	private async handleAdd(path: string, title: string, jump: boolean, buttons: HTMLButtonElement[]): Promise<void> {
		if (this.busy) return;
		this.busy = true;
		const textToFile = this.draftText;
		const textareaAtStart = this.draftTextarea;
		buttons.forEach((b) => (b.disabled = true));
		if (textareaAtStart) textareaAtStart.disabled = true;
		try {
			await appendToNote(this.plugin.app, path, textToFile);
			this.filedHighlights.set(path, textToFile);
			this.touchSidebarNote(path, title);
			if (this.draftText === textToFile) this.draftText = "";
			this.resetDecision();
			this.activeNoteId = jump ? path : QUICK_CAPTURE_ID;
			this.render();
		} catch (e) {
			console.error("AI Notes: append failed", e);
			new Notice("AI Notes: couldn't add to the note — see console for details.");
			buttons.forEach((b) => (b.disabled = false));
			if (textareaAtStart) textareaAtStart.disabled = false;
		} finally {
			this.busy = false;
		}
	}

	/** See handleAdd's append-text-invariant note above -- the same treatment applies to
	 *  `createNote()`'s content payload. The title `<input>` is also disabled for the duration
	 *  so a late title edit can't appear accepted while being silently ignored. */
	private async handleCreate(input: HTMLInputElement, buttons: HTMLButtonElement[]): Promise<void> {
		if (this.busy) return;
		const title = input.value.trim();
		if (!title) {
			input.focus();
			return;
		}
		this.busy = true;
		const textToFile = this.draftText;
		const textareaAtStart = this.draftTextarea;
		buttons.forEach((b) => (b.disabled = true));
		input.disabled = true;
		if (textareaAtStart) textareaAtStart.disabled = true;
		try {
			const file = await createNote(this.plugin.app, title, textToFile);
			this.filedHighlights.set(file.path, textToFile);
			this.touchSidebarNote(file.path, file.basename);
			if (this.draftText === textToFile) this.draftText = "";
			this.resetDecision();
			this.activeNoteId = file.path;
			this.render();
		} catch (e) {
			console.error("AI Notes: failed to create note", e);
			new Notice("AI Notes: couldn't create the note — see console for details.");
			buttons.forEach((b) => (b.disabled = false));
			input.disabled = false;
			if (textareaAtStart) textareaAtStart.disabled = false;
		} finally {
			this.busy = false;
		}
	}

	// ---------- manual note-search override ("Search notes instead") ----------
	//
	// A quiet secondary trigger on every decision card that reveals a bounded, local
	// title/path metadata search (rankNoteMetadata -- no embeddings, no HybridSearch, no
	// vault-content reads). Selecting a result always ends up at the *same* Add-and-jump /
	// Add-and-stay-here choice the confident card gives for its AI top result, reusing the one
	// shared `handleAdd` destination handler -- see this task's brief for why manual selection
	// doesn't inherit the ambiguous card's immediate single-click-jump behavior: a typed query
	// is a more deliberate act than clicking an AI-suggested candidate, so it gets at least as
	// much control, not less.

	/** Renders either the closed-state trigger button or (once opened) the picker itself,
	 *  inside `card`. Shared by all three decision-card variants so they can't drift. */
	private renderNotePickerSection(card: HTMLElement, footerEl: HTMLElement): void {
		const section = card.createDiv({ cls: "ai-quickcap-search-row" });

		if (!this.isNotePickerOpen) {
			const trigger = section.createEl("button", {
				cls: "ai-quickcap-search-trigger",
				text: "Search notes instead",
			});
			trigger.addEventListener("click", () => {
				this.isNotePickerOpen = true;
				this.notePickerQuery = "";
				this.notePickerResults = [];
				this.highlightedResultIndex = -1;
				this.notePickerSelection = null;
				this.renderFooter(footerEl);
			});
			return;
		}

		if (this.notePickerSelection) this.renderNotePickerConfirm(section, footerEl);
		else this.renderNotePickerSearch(section, footerEl);
	}

	/** The search input + bounded results list. The `<input>` element is created once per open
	 *  and never recreated while the user types -- only the results list below it re-renders on
	 *  each keystroke/arrow-key move, so focus/cursor position is never disturbed (same pattern
	 *  as the Quick Capture draft textarea in renderQuickCapture). */
	private renderNotePickerSearch(section: HTMLElement, footerEl: HTMLElement): void {
		const picker = section.createDiv({ cls: "ai-quickcap-picker" });

		const header = picker.createDiv({ cls: "ai-quickcap-picker-header" });
		const input = header.createEl("input", {
			cls: "ai-quickcap-picker-input",
			attr: {
				type: "text",
				placeholder: "Type a note title or path…",
				"aria-label": "Search notes",
				role: "combobox",
				"aria-expanded": "true",
			},
		});
		input.value = this.notePickerQuery;
		const closeBtn = header.createEl("button", {
			cls: "ai-quickcap-picker-close",
			attr: { "aria-label": "Close search", title: "Close search" },
			text: "×",
		});

		const resultsEl = picker.createDiv({ cls: "ai-quickcap-picker-results", attr: { role: "listbox" } });

		const closePicker = () => {
			this.resetNotePicker();
			this.renderFooter(footerEl);
		};

		const selectResult = (item: NotePickerItem) => {
			this.notePickerSelection = item;
			this.renderFooter(footerEl);
		};

		const runSearch = () => {
			const query = this.notePickerQuery.trim();
			// No embedText/search() here -- metadata-only, per the brief's locked architecture.
			this.notePickerResults = query ? rankNoteMetadata(query, this.plugin.cache.getAll()) : [];
			this.highlightedResultIndex = this.notePickerResults.length > 0 ? 0 : -1;
			this.renderNotePickerResults(resultsEl, selectResult);
		};

		input.addEventListener("input", () => {
			this.notePickerQuery = input.value;
			runSearch();
		});

		input.addEventListener("keydown", (evt: KeyboardEvent) => {
			if (evt.key === "Escape") {
				evt.preventDefault();
				closePicker();
			} else if (evt.key === "ArrowDown") {
				evt.preventDefault();
				if (this.notePickerResults.length === 0) return;
				this.highlightedResultIndex = (this.highlightedResultIndex + 1) % this.notePickerResults.length;
				this.renderNotePickerResults(resultsEl, selectResult);
			} else if (evt.key === "ArrowUp") {
				evt.preventDefault();
				if (this.notePickerResults.length === 0) return;
				this.highlightedResultIndex =
					(this.highlightedResultIndex - 1 + this.notePickerResults.length) % this.notePickerResults.length;
				this.renderNotePickerResults(resultsEl, selectResult);
			} else if (evt.key === "Enter") {
				evt.preventDefault();
				const picked = this.notePickerResults[this.highlightedResultIndex];
				if (picked) selectResult(picked);
			}
		});

		closeBtn.addEventListener("click", () => closePicker());

		this.renderNotePickerResults(resultsEl, selectResult);
		input.focus();
	}

	private renderNotePickerResults(resultsEl: HTMLElement, onSelect: (item: NotePickerItem) => void): void {
		resultsEl.empty();
		const query = this.notePickerQuery.trim();

		if (!query) {
			resultsEl.createDiv({ cls: "ai-quickcap-picker-hint", text: "Type a note title or path." });
			return;
		}
		if (this.notePickerResults.length === 0) {
			resultsEl.createDiv({ cls: "ai-quickcap-picker-hint", text: "No notes found." });
			return;
		}

		this.notePickerResults.forEach((item, i) => {
			const row = resultsEl.createDiv({
				cls: "ai-quickcap-picker-row" + (i === this.highlightedResultIndex ? " is-highlighted" : ""),
				attr: { title: item.path, role: "option", "aria-selected": String(i === this.highlightedResultIndex) },
			});
			row.createSpan({ cls: "ai-quickcap-picker-row-title", text: item.title });
			row.createSpan({ cls: "ai-quickcap-picker-row-path", text: item.path });
			row.addEventListener("mouseenter", () => {
				this.highlightedResultIndex = i;
				this.renderNotePickerResults(resultsEl, onSelect);
			});
			row.addEventListener("click", () => onSelect(item));
		});
	}

	/** Selected-destination confirm step: same action set the confident card gives its AI top
	 *  result (Add and jump / Add and stay here), via the same shared `handleAdd` -- see the
	 *  section header comment above for why manual selection always gets this choice. "Back"
	 *  returns to the search results without losing the query. */
	private renderNotePickerConfirm(section: HTMLElement, footerEl: HTMLElement): void {
		const selection = this.notePickerSelection;
		if (!selection) return;

		const confirm = section.createDiv({ cls: "ai-quickcap-picker-confirm" });
		confirm.createDiv({
			cls: "ai-quickcap-card-title",
			text: selection.title,
			attr: { title: selection.path },
		});

		const actions = confirm.createDiv({ cls: "ai-quickcap-actions" });
		const addJumpBtn = actions.createEl("button", { cls: "ai-quickcap-btn ai-quickcap-btn--primary", text: "Add and jump" });
		const addStayBtn = actions.createEl("button", {
			cls: "ai-quickcap-btn ai-quickcap-btn--secondary",
			text: "Add and stay here",
		});
		const backBtn = actions.createEl("button", { cls: "ai-quickcap-btn ai-quickcap-btn--ghost", text: "Back" });

		const buttons = [addJumpBtn, addStayBtn, backBtn];
		addJumpBtn.addEventListener("click", () => void this.handleAdd(selection.path, selection.title, true, buttons));
		addStayBtn.addEventListener("click", () => void this.handleAdd(selection.path, selection.title, false, buttons));
		backBtn.addEventListener("click", () => {
			this.notePickerSelection = null;
			this.renderFooter(footerEl);
		});
	}

	// ---------- destination note (static render) ----------

	private async renderDestinationNote(path: string): Promise<void> {
		const body = this.mainEl.createDiv({ cls: "ai-quickcap-static-body" });
		const file = this.plugin.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) {
			body.createDiv({ cls: "ai-quickcap-empty-note", text: "This note is no longer available." });
			return;
		}

		let content: string;
		try {
			content = await this.plugin.app.vault.cachedRead(file);
		} catch (e) {
			console.error("AI Notes: failed to read note", e);
			if (this.activeNoteId !== path) return; // navigated elsewhere while the read was in flight
			body.createDiv({ cls: "ai-quickcap-empty-note", text: "Couldn't load this note." });
			new Notice("AI Notes: couldn't load this note — see console for details.");
			return;
		}
		// The user may have navigated elsewhere while this read was in flight.
		if (this.activeNoteId !== path) return;

		const lines = content.split("\n").filter((l) => l.trim().length > 0);
		if (lines.length === 0) {
			body.createDiv({ cls: "ai-quickcap-empty-note", text: "This note is empty." });
			return;
		}

		const highlight = this.filedHighlights.get(path);
		const range = highlight ? findHighlightRange(lines, highlight) : null;

		lines.forEach((line, i) => {
			const isHighlighted = !!range && i >= range[0] && i <= range[1];
			body.createEl("p", {
				cls: "ai-quickcap-line" + (isHighlighted ? " is-highlighted" : ""),
				text: line,
			});
		});
	}

	private async loadExcerpt(path: string): Promise<string> {
		const file = this.plugin.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) return "";
		try {
			const content = await this.plugin.app.vault.cachedRead(file);
			const trimmed = content.trim();
			if (!trimmed) return "";
			const truncated = trimmed.length > EXCERPT_TAIL_LEN;
			const raw = truncated ? trimmed.slice(-EXCERPT_TAIL_LEN) : trimmed;
			const snippet = sanitizeExcerpt(raw);
			return truncated ? `…${snippet}` : snippet;
		} catch {
			return "";
		}
	}
}
