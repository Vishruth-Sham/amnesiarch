import { ItemView, WorkspaceLeaf, Notice, TFile } from "obsidian";
import type AiNotesPlugin from "../../main";
import { VIEW_TYPE_AI_NOTES_QUICK_CAPTURE, MIN_CONFIDENCE, MIN_MARGIN } from "../constants";
import { search } from "../search/HybridSearch";
import { embedText } from "../embeddings/EmbeddingModel";
import { appendToNote } from "../append/AppendService";
import { createNote, createNoteAtDestination, proposeTitle, DestinationCreateError } from "../create/CreateNoteService";
import {
	DestinationChoice,
	DestinationPlan,
	FolderInfo,
	FolderSnapshot,
	SegmentResolution,
	TitleSource,
	buildFolderSnapshot,
	parseDestinationInstruction,
	resolveFolderDestination,
	isDestinationParseError,
	segmentChoiceKey,
	sanitizeTitleForPath,
} from "../create/FolderDestination";
import { rankNoteMetadata, NotePickerItem } from "../search/NotePicker";
import { AnchoredTooltipController, setQuickCaptureTooltip } from "./AnchoredTooltip";
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

/** Shared decision-card shell regions -- see QuickCaptureView.createDecisionShell(). Private to
 *  this module; nothing outside QuickCaptureView consumes it (brief: "do not export
 *  abstractions with only one consumer"). */
interface DecisionShellParts {
	card: HTMLElement;
	content: HTMLElement;
	picker: HTMLElement;
	divider: HTMLElement;
	actionStart: HTMLElement;
	actionEnd: HTMLElement;
}

interface DecisionAction {
	label: string;
	variant: "primary" | "secondary" | "ghost";
	onClick: () => void;
}

/** Options for QuickCaptureView.renderMatchRow() -- the shared confident/ambiguous result row. */
interface MatchRowOptions {
	title: string;
	path: string;
	score: number;
	topScore: number;
	isTop: boolean;
	/** When present, the row renders as a `<button>` and fires this on click (ambiguous rows'
	 *  existing immediate add-and-jump behavior). Omitted for the confident card's single,
	 *  display-only row -- its actions live in the shared action row instead. */
	onClick?: () => void;
}

/**
 * Bar width for a result row, relative to the visible top result -- never an absolute
 * confidence claim. Bounded to [10, 100] and defensive against a zero/non-finite top score so
 * the caller can never end up writing `NaN%`/`Infinity%` into a `style` attribute (design
 * change #5: "raw hybrid-search percentages don't mean anything to a user without a reference
 * point").
 */
function relativeMatchStrength(score: number, topScore: number): number {
	const safeTop = Number.isFinite(topScore) && topScore > 0 ? topScore : Number.EPSILON;
	const safeScore = Number.isFinite(score) ? Math.max(score, 0) : 0;
	const percent = (safeScore / safeTop) * 100;
	if (!Number.isFinite(percent)) return 10;
	return Math.min(Math.max(percent, 10), 100);
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

	// ---- "Describe destination" state (design handoff: quick-capture-folder-destination.md) ----
	// Ephemeral and tied to the exact draft it was computed for (destinationDraftSnapshot) --
	// see clearDestinationState()/recomputeDestinationPlan() and the brief's "Input lifecycle".
	private destinationText = "";
	private destinationPlan: DestinationPlan | null = null;
	private destinationChoices = new Map<string, DestinationChoice>();
	private destinationDraftSnapshot: string | null = null;
	/** Cached alongside destinationPlan purely so "Choose another folder" can list siblings
	 *  without rebuilding the snapshot on every click. */
	private folderSnapshot: FolderSnapshot | null = null;
	private titleValue = "";
	/** Once true, destination typing/plan changes can never overwrite titleValue again -- only
	 *  the title input's own `input` handler may (title precedence rule #1). */
	private titleDirty = false;
	private titleSource: TitleSource = "capture-proposal";
	/** segmentKey of the fuzzy correction currently showing its bounded "choose another folder"
	 *  sibling list, or null. Purely transient render state, not part of the accepted plan. */
	private destinationExpandedChoice: string | null = null;

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
	/** Currently-mounted create-card title input / destination textarea, if the create card is
	 *  showing -- used only to focus/select them from other controls ("Change title", "Edit
	 *  destination"), never snapshotted across an await. */
	private titleInputEl: HTMLInputElement | null = null;
	private destinationTextareaEl: HTMLTextAreaElement | null = null;
	/** Guards against overlapping Sort/Add/Create requests; all three are mutually exclusive
	 *  from the UI at any given moment. */
	private busy = false;
	private tooltipController: AnchoredTooltipController | null = null;

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

		this.tooltipController = new AnchoredTooltipController();
		this.tooltipController.attach(root);

		this.render();
	}

	async onClose(): Promise<void> {
		this.tooltipController?.destroy();
		this.tooltipController = null;
		this.clearDestinationState();
	}

	// ---------- state transition helpers ----------

	/** Dismisses the current AI decision (Sort result / forceCreate) for the same draft. Does
	 *  NOT touch destination/title state -- "Keep editing" and re-sorting an unchanged draft must
	 *  restore whatever destination text/plan/choices the user already entered (brief "Input
	 *  lifecycle": destination state survives Keep editing). Callers that mean "this draft's
	 *  destination targets different content now" call clearDestinationState() explicitly instead. */
	private resetDecision(): void {
		this.sorted = false;
		this.forceCreate = false;
		this.lastResults = null;
		this.resetNotePicker();
	}

	/** Clears all "Describe destination" state -- draft edits, successful filing (append or
	 *  create), and view disposal all invalidate it because it may have targeted content that no
	 *  longer exists (brief "Input lifecycle": "Any edit to the Quick Capture draft clears the
	 *  destination instruction..."; "Successful append... successful creation... view disposal
	 *  clears all destination state"). "Keep editing" deliberately never calls this. */
	private clearDestinationState(): void {
		this.destinationText = "";
		this.destinationPlan = null;
		this.destinationChoices = new Map();
		this.destinationDraftSnapshot = null;
		this.folderSnapshot = null;
		this.titleValue = "";
		this.titleDirty = false;
		this.titleSource = "capture-proposal";
		this.destinationExpandedChoice = null;
	}

	/**
	 * Re-parses/resolves `destinationText` against a fresh live folder snapshot and stores the
	 * result in `destinationPlan`. Pure logic lives entirely in FolderDestination.ts -- this
	 * method's only job is supplying the live vault snapshot/settings and applying the view's own
	 * title-precedence rule (#1 manual edit always wins) on top of the plan's own noteTitle.
	 */
	private recomputeDestinationPlan(): void {
		const fallbackTitle = proposeTitle(this.draftText);
		const parsed = parseDestinationInstruction(this.destinationText);

		if (isDestinationParseError(parsed)) {
			this.folderSnapshot = null;
			this.destinationExpandedChoice = null;
			this.destinationPlan = {
				status: "invalid",
				segments: [],
				folderPath: "",
				noteTitle: this.titleDirty ? this.titleValue : fallbackTitle,
				notePath: "",
				titleSource: this.titleDirty ? "user-edited" : "capture-proposal",
				missingFolders: [],
				warnings: [parsed.reason],
			};
			if (!this.titleDirty) {
				this.titleValue = fallbackTitle;
				this.titleSource = "capture-proposal";
			}
			return;
		}

		this.folderSnapshot = buildFolderSnapshot(this.plugin.app.vault.getAllFolders());
		const plan = resolveFolderDestination(parsed, this.folderSnapshot, this.destinationChoices, fallbackTitle, undefined, this.plugin.settings.excludePatterns);

		if (this.titleDirty) {
			const sanitized = sanitizeTitleForPath(this.titleValue);
			const canBuildPath = plan.status === "ready" || plan.status === "root";
			this.destinationPlan = {
				...plan,
				noteTitle: this.titleValue,
				titleSource: "user-edited",
				notePath: canBuildPath ? (plan.folderPath ? `${plan.folderPath}/${sanitized}.md` : `${sanitized}.md`) : "",
			};
		} else {
			this.destinationPlan = plan;
			this.titleValue = plan.noteTitle;
			this.titleSource = plan.titleSource;
		}
	}

	/** Gates the primary "Create and jump" action -- see brief "Action and confirmation behavior"
	 *  for the full disable-condition list. A blank/root plan keeps today's numeric-suffix root
	 *  behavior (never blocked by a note-path collision here); a non-empty targeted plan blocks on
	 *  any unresolved segment or a live note-path collision, checked fresh against the vault. */
	private canCreateFromPlan(): boolean {
		const plan = this.destinationPlan;
		if (!plan) return false;
		if (plan.status !== "root" && plan.status !== "ready") return false;
		if (plan.status === "ready" && this.plugin.app.vault.getAbstractFileByPath(plan.notePath)) return false;
		return true;
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
		// About to tear down/rebuild DOM the tooltip may be anchored to -- hide it immediately
		// rather than waiting on the MutationObserver backstop in AnchoredTooltipController.
		this.tooltipController?.hide();
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
				attr: { type: "button" },
			});
			setQuickCaptureTooltip(row, item.title);
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
			attr: {
				placeholder: "Summarize this document",
				"aria-label": "Quick capture note",
				spellcheck: "false",
			},
		});
		setQuickCaptureTooltip(textarea, "Quick capture note");
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
			// A destination plan/title typed against the old text may target content that no
			// longer exists once the draft changes (brief "Input lifecycle").
			this.clearDestinationState();
			this.renderFooter(footerEl);
		});

		this.renderFooter(footerEl);
		textarea.focus();
	}

	private renderFooter(footerEl: HTMLElement): void {
		this.tooltipController?.hide();
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
	//
	// All four decision states (confident/ambiguous/create/empty-index) render through one
	// shared shell (card, content, optional picker region, divider, start/end action groups) so
	// they read as states of one component rather than independently-designed screens --
	// design_change/quick-capture-design-improvements.md #5-#7.

	/** A quiet, minimal warning shown on any decision card while the vault index is still
	 *  building (review correction #5) -- read synchronously from the existing
	 *  `indexer.isIndexing()` at render time, not a new indexer-event subscription. */
	private renderIndexingHint(container: HTMLElement): void {
		if (!this.plugin.indexer.isIndexing()) return;
		container.createDiv({
			cls: "ai-quickcap-card-hint",
			text: "Index is still building — results may be incomplete.",
		});
	}

	/** Builds the shared card chrome: header copy, a content region for state-specific rows/
	 *  fields, an (initially empty, collapses via CSS `:empty`) picker region, a divider, and
	 *  a two-group action row (start = destination/create/search actions, end = Keep editing --
	 *  `justify-content:space-between` on the row is what gives "Keep editing" its flexible,
	 *  always-far-right spacer without a manual spacer element). */
	private createDecisionShell(footerEl: HTMLElement, headerCopy: string): DecisionShellParts {
		const card = footerEl.createDiv({ cls: "ai-quickcap-card" });
		card.createDiv({ cls: "ai-quickcap-card-copy", text: headerCopy });
		const content = card.createDiv({ cls: "ai-quickcap-content" });
		const picker = card.createDiv({ cls: "ai-quickcap-picker-region" });
		const divider = card.createDiv({ cls: "ai-quickcap-divider" });
		const actionRow = card.createDiv({ cls: "ai-quickcap-actions" });
		const actionStart = actionRow.createDiv({ cls: "ai-quickcap-actions-start" });
		const actionEnd = actionRow.createDiv({ cls: "ai-quickcap-actions-end" });
		return { card, content, picker, divider, actionStart, actionEnd };
	}

	/** Builds one action-row button. Returns the element so callers can collect it into a
	 *  busy-disable set -- see handleAdd/handleCreate's `buttons` parameter. */
	private renderAction(container: HTMLElement, action: DecisionAction): HTMLButtonElement {
		const btn = container.createEl("button", {
			cls: `ai-quickcap-btn ai-quickcap-btn--${action.variant}`,
			text: action.label,
			attr: { type: "button" },
		});
		btn.addEventListener("click", action.onClick);
		return btn;
	}

	/** One result row shared by the confident (single row) and ambiguous (up to three rows)
	 *  cards: title + a relative-strength bar, never a raw hybrid-search percentage (design
	 *  change #5). Renders as a `<button>` (and wires `onClick`) when the row itself is
	 *  directly selectable -- ambiguous rows keep their existing immediate add-and-jump
	 *  behavior; the confident card's single row is display-only, since its actions live in the
	 *  action row below instead. */
	private renderMatchRow(container: HTMLElement, opts: MatchRowOptions): HTMLElement {
		const cls = "ai-quickcap-match-row" + (opts.isTop ? " is-top" : "");
		const row: HTMLElement = opts.onClick
			? container.createEl("button", { cls, attr: { type: "button" } })
			: container.createDiv({ cls });
		setQuickCaptureTooltip(row, opts.path);
		// Accessible text describes order/relative strength, never the hidden raw score.
		row.setAttribute("aria-label", opts.isTop ? `${opts.title} — best match` : `${opts.title} — relative match strength`);
		row.createSpan({ cls: "ai-quickcap-match-row-title", text: opts.title });
		const track = row.createDiv({ cls: "ai-quickcap-match-bar-track" });
		const pct = relativeMatchStrength(opts.score, opts.topScore);
		track.createDiv({ cls: "ai-quickcap-match-bar-fill", attr: { style: `width:${pct}%` } });
		if (opts.isTop) row.createSpan({ cls: "ai-quickcap-match-row-label", text: "best match" });
		if (opts.onClick) row.addEventListener("click", opts.onClick);
		return row;
	}

	/** Shared "Search instead" open behavior for all three cards -- reveals the existing bounded
	 *  metadata picker in the shell's picker region without touching the draft or the automatic
	 *  decision (`rankNoteMetadata()`/keyboard nav/confirm behavior are all unchanged). */
	private openNotePicker(footerEl: HTMLElement): void {
		this.isNotePickerOpen = true;
		this.notePickerQuery = "";
		this.notePickerResults = [];
		this.highlightedResultIndex = -1;
		this.notePickerSelection = null;
		this.renderFooter(footerEl);
	}

	private renderMatchCard(footerEl: HTMLElement, results: SearchResult[]): void {
		const top = results[0];
		const shell = this.createDecisionShell(footerEl, "Confident match found");

		const list = shell.content.createDiv({ cls: "ai-quickcap-match-list" });
		this.renderMatchRow(list, { title: top.entry.title, path: top.entry.path, score: top.score, topScore: top.score, isTop: true });

		const excerptEl = shell.content.createDiv({ cls: "ai-quickcap-excerpt" });
		void this.loadExcerpt(top.entry.path).then((snippet) => {
			if (snippet) excerptEl.setText(snippet);
			else excerptEl.remove();
		});

		this.renderIndexingHint(shell.content);
		this.renderNotePickerBody(shell.picker, footerEl);

		// `let` so the click closures below (created first) can capture the binding and see the
		// fully-populated array once it's assigned after all buttons exist -- no button can
		// possibly be clicked before this synchronous function returns.
		let buttons: HTMLButtonElement[] = [];
		const addJumpBtn = this.renderAction(shell.actionStart, {
			label: "Add and jump",
			variant: "primary",
			onClick: () => void this.handleAdd(top.entry.path, top.entry.title, true, buttons),
		});
		const addStayBtn = this.renderAction(shell.actionStart, {
			label: "Add and stay here",
			variant: "secondary",
			onClick: () => void this.handleAdd(top.entry.path, top.entry.title, false, buttons),
		});
		const createNewBtn = this.renderAction(shell.actionStart, {
			label: "Create new note",
			variant: "secondary",
			onClick: () => {
				this.forceCreate = true;
				this.resetNotePicker();
				this.renderFooter(footerEl);
			},
		});
		const searchInsteadBtn = this.isNotePickerOpen
			? null
			: this.renderAction(shell.actionStart, {
					label: "Search instead",
					variant: "ghost",
					onClick: () => this.openNotePicker(footerEl),
				});
		const keepEditingBtn = this.renderAction(shell.actionEnd, {
			label: "Keep editing",
			variant: "ghost",
			onClick: () => {
				this.resetDecision();
				this.renderFooter(footerEl);
			},
		});

		buttons = [addJumpBtn, addStayBtn, createNewBtn, keepEditingBtn, ...(searchInsteadBtn ? [searchInsteadBtn] : [])];
	}

	private renderAmbiguousCard(footerEl: HTMLElement, results: SearchResult[]): void {
		const shell = this.createDecisionShell(footerEl, "A few notes could match");
		const candidates = results.slice(0, 3);
		const topScore = Math.max(candidates[0]?.score ?? 0, Number.EPSILON);
		const top = candidates[0];

		let allControls: HTMLButtonElement[] = [];

		const list = shell.content.createDiv({ cls: "ai-quickcap-match-list" });
		const rows = candidates.map(
			(result, i) =>
				this.renderMatchRow(list, {
					title: result.entry.title,
					path: result.entry.path,
					score: result.score,
					topScore,
					isTop: i === 0,
					onClick: () => void this.handleAdd(result.entry.path, result.entry.title, true, allControls),
				}) as HTMLButtonElement,
		);

		this.renderIndexingHint(shell.content);
		this.renderNotePickerBody(shell.picker, footerEl);

		const useTopBtn = this.renderAction(shell.actionStart, {
			label: `Use "${top.entry.title}"`,
			variant: "primary",
			onClick: () => void this.handleAdd(top.entry.path, top.entry.title, true, allControls),
		});
		const createNewBtn = this.renderAction(shell.actionStart, {
			label: "Create new note",
			variant: "secondary",
			onClick: () => {
				this.forceCreate = true;
				// Swapping to the create card replaces the active decision without going through
				// resetDecision() (sorted/lastResults must survive so "Keep editing" from the
				// create card can't be reached here -- Back doesn't exist anymore, but sorted must
				// still hold in case forceCreate is ever cleared some other way) -- the picker
				// itself still needs a fresh start under the new card, though.
				this.resetNotePicker();
				this.renderFooter(footerEl);
			},
		});
		const searchInsteadBtn = this.isNotePickerOpen
			? null
			: this.renderAction(shell.actionStart, {
					label: "Search instead",
					variant: "ghost",
					onClick: () => this.openNotePicker(footerEl),
				});
		const keepEditingBtn = this.renderAction(shell.actionEnd, {
			label: "Keep editing",
			variant: "ghost",
			onClick: () => {
				this.resetDecision();
				this.renderFooter(footerEl);
			},
		});

		// All rows and every action are disabled together while any one candidate's append is in
		// flight -- otherwise "Create new note"/"Keep editing" could fire mid-write and have
		// their effect silently discarded once the original append's resetDecision() runs
		// (review correction #1: "all controls relevant to ... Add" while an operation is busy).
		allControls = [...rows, useTopBtn, createNewBtn, keepEditingBtn, ...(searchInsteadBtn ? [searchInsteadBtn] : [])];
	}

	private renderCreateCard(footerEl: HTMLElement, reason: "empty-index" | "low-confidence"): void {
		// Zero results means the cache was empty when Sort ran (search() maps 1:1 over
		// plugin.cache.getAll()) -- that's a coverage gap, never a considered judgment that
		// nothing matched, and must be described honestly rather than as "no confident match"
		// (review correction #5).
		const headerCopy =
			reason === "empty-index"
				? this.plugin.indexer.isIndexing()
					? "Still indexing — no notes to compare yet"
					: "No notes indexed yet — new note"
				: "No confident match — new note";
		const shell = this.createDecisionShell(footerEl, headerCopy);

		// Already covered by the "Still indexing…" header copy above when reason is
		// "empty-index" -- only add the separate hint here so the two messages don't say the
		// same thing twice.
		if (reason === "low-confidence") this.renderIndexingHint(shell.content);

		// "Opening a create card for a draft initializes an empty destination field unless that
		// unchanged draft already has preserved destination state" (brief "Input lifecycle") --
		// this mount-time check is the only place destination/title state gets reset for a new
		// draft; clearDestinationState() (draft edits, successful filing, disposal) is separate.
		if (this.destinationDraftSnapshot !== this.draftText) {
			this.destinationText = "";
			this.destinationChoices = new Map();
			this.titleValue = "";
			this.titleDirty = false;
			this.titleSource = "capture-proposal";
			this.destinationExpandedChoice = null;
			this.destinationDraftSnapshot = this.draftText;
		}
		this.recomputeDestinationPlan();

		const input = shell.content.createEl("input", {
			cls: "ai-quickcap-title-input",
			attr: { type: "text", "aria-label": "New note title" },
		});
		setQuickCaptureTooltip(input, "New note title");
		input.value = this.titleValue;
		this.titleInputEl = input;

		const destWrap = shell.content.createDiv({ cls: "ai-quickcap-destination" });
		destWrap.createDiv({ cls: "ai-quickcap-destination-label", text: "Describe destination (optional)" });
		const destInput = destWrap.createEl("textarea", {
			cls: "ai-quickcap-destination-input",
			attr: {
				placeholder: "New folder Experiments under AI inside Learning",
				"aria-label": "Describe destination",
				spellcheck: "false",
				rows: "2",
			},
		});
		destInput.value = this.destinationText;
		setQuickCaptureTooltip(destInput, 'Try "New folder Experiments under AI inside Learning" or "Learning/AI/Experiments"');
		this.destinationTextareaEl = destInput;
		destWrap.createDiv({
			cls: "ai-quickcap-destination-hint",
			text: 'Name existing parent folders and any folder to create. "/" also works.',
		});

		const previewEl = shell.content.createDiv({ cls: "ai-quickcap-destination-preview" });

		const createBtn = this.renderAction(shell.actionStart, {
			label: "Create and jump",
			variant: "primary",
			onClick: () => void this.handleCreate(input, destInput, shell.card, footerEl),
		});

		// The destination textarea and title input are each created once and never recreated on
		// every keystroke (same pattern as the Quick Capture draft textarea) -- only the bounded
		// preview region below them re-renders, so focus/caret is never disturbed while typing.
		const refreshPreviewOnly = () => {
			this.recomputeDestinationPlan();
			this.renderDestinationPreview(previewEl, footerEl);
			createBtn.disabled = !this.canCreateFromPlan();
		};

		input.addEventListener("input", () => {
			this.titleValue = input.value;
			this.titleDirty = true;
			this.titleSource = "user-edited";
			refreshPreviewOnly();
		});

		destInput.addEventListener("input", () => {
			this.destinationText = destInput.value;
			// New destination text invalidates prior fuzzy/ambiguous/collision choices -- they
			// were scoped to the previous parse's segment positions, not necessarily this one.
			this.destinationChoices = new Map();
			this.destinationExpandedChoice = null;
			refreshPreviewOnly();
		});

		this.renderNotePickerBody(shell.picker, footerEl);

		if (!this.isNotePickerOpen) {
			this.renderAction(shell.actionStart, {
				label: "Search instead",
				variant: "ghost",
				onClick: () => this.openNotePicker(footerEl),
			});
		}
		// Matches the design prototype's onBackFromCreate exactly: always clears back to plain
		// editing (sorted:false, forceCreate:false). Labeled "Keep editing" per the design
		// change, not "Back" -- both this card's Back and the confident/ambiguous cards' Keep
		// editing were always the same action (dismiss the decision, keep the draft). Destination/
		// title state deliberately survives this -- see clearDestinationState()'s doc comment.
		this.renderAction(shell.actionEnd, {
			label: "Keep editing",
			variant: "ghost",
			onClick: () => {
				this.resetDecision();
				this.renderFooter(footerEl);
			},
		});

		this.renderDestinationPreview(previewEl, footerEl);
		createBtn.disabled = !this.canCreateFromPlan();

		// Don't steal focus from an already-open picker's own search input (renderNotePickerBody
		// above already focused it) -- only claim it here on the card's own initial render.
		if (!this.isNotePickerOpen) {
			input.focus();
			input.select();
		}
	}

	/** Disables (or re-enables) every interactive control inside a decision card at once -- used
	 *  while a create is in flight so a stray click on a correction/ambiguity/collision button,
	 *  the picker, or "Keep editing" can't race the in-progress mutation (brief acceptance
	 *  criterion 17). Simpler and more robust than threading an explicit button list through the
	 *  create card's many dynamically-rendered destination sub-widgets. */
	private setCardControlsDisabled(card: HTMLElement, disabled: boolean): void {
		card.querySelectorAll("button, input, textarea").forEach((el) => {
			(el as HTMLButtonElement | HTMLInputElement | HTMLTextAreaElement).disabled = disabled;
		});
	}

	/** Renders the live destination preview: the resolved-so-far folder/note tree, plus whichever
	 *  correction/ambiguity/collision widget (if any) is blocking full resolution. Rebuilds
	 *  `previewEl` from scratch on every call -- cheap, and it never owns focus itself. */
	private renderDestinationPreview(previewEl: HTMLElement, footerEl: HTMLElement): void {
		previewEl.empty();
		const plan = this.destinationPlan;
		if (!plan) return;

		if (plan.status === "invalid") {
			previewEl.createDiv({
				cls: "ai-quickcap-destination-error",
				text: plan.warnings[0] ?? "That destination couldn't be understood.",
			});
			return;
		}

		const tree = previewEl.createDiv({ cls: "ai-quickcap-destination-tree" });
		tree.createDiv({ cls: "ai-quickcap-destination-tree-label", text: "Destination" });
		if (plan.segments.length === 0) {
			const rootRow = tree.createDiv({ cls: "ai-quickcap-destination-tree-row", attr: { style: "--qc-depth:0" } });
			rootRow.createSpan({ cls: "ai-quickcap-destination-tree-name", text: "Vault root" });
			rootRow.createSpan({ cls: "ai-quickcap-destination-tree-tag", text: "Existing" });
		}
		plan.segments.forEach((seg, depth) => this.renderDestinationTreeRow(tree, seg, depth));

		if (plan.status === "needs-confirmation") {
			const last = plan.segments.at(-1);
			if (last?.kind === "fuzzy") this.renderDestinationCorrection(previewEl, footerEl, last, plan.segments.length - 1);
			return;
		}
		if (plan.status === "ambiguous") {
			const last = plan.segments.at(-1);
			if (last?.kind === "ambiguous") this.renderDestinationAmbiguous(previewEl, footerEl, last, plan.segments.length - 1);
			return;
		}
		if (plan.status === "collision") {
			const last = plan.segments.at(-1);
			if (last?.kind === "collision") this.renderDestinationCollision(previewEl, footerEl, last, plan.segments.length - 1);
			return;
		}

		// status is "root" or "ready" here -- both are visibly-complete plans.
		const noteRow = tree.createDiv({ cls: "ai-quickcap-destination-tree-row", attr: { style: `--qc-depth:${plan.segments.length}` } });
		noteRow.createSpan({ cls: "ai-quickcap-destination-tree-name", text: `${sanitizeTitleForPath(plan.noteTitle)}.md` });
		const titleLabel =
			plan.titleSource === "user-edited"
				? "title edited by you"
				: plan.titleSource === "destination"
					? "title from destination description"
					: "title inferred from capture";
		noteRow.createSpan({ cls: "ai-quickcap-destination-tree-tag", text: `New note · ${titleLabel}` });

		if (plan.status === "ready" && this.plugin.app.vault.getAbstractFileByPath(plan.notePath)) {
			this.renderDestinationNoteCollision(previewEl, footerEl, plan.notePath);
			return;
		}

		previewEl.createDiv({ cls: "ai-quickcap-destination-final-path", text: `Final path: ${plan.notePath}` });
		previewEl.createDiv({
			cls: "ai-quickcap-destination-note-hint",
			text: "The captured text will be used as the note content.",
		});
	}

	private renderDestinationTreeRow(container: HTMLElement, seg: SegmentResolution, depth: number): void {
		const row = container.createDiv({ cls: "ai-quickcap-destination-tree-row", attr: { style: `--qc-depth:${depth}` } });
		let name: string;
		let tag: string;
		switch (seg.kind) {
			case "exact":
				name = seg.folder.name;
				tag = "Existing";
				break;
			case "fuzzy":
				name = seg.acknowledged ? seg.folder.name : seg.requested;
				tag = seg.acknowledged ? `Existing · corrected from "${seg.requested}"` : "Needs confirmation";
				break;
			case "ambiguous":
				name = seg.requested;
				tag = "Ambiguous";
				break;
			case "create":
				name = seg.requested;
				tag = "New folder";
				break;
			case "collision":
				name = seg.requested;
				tag = "Existing folder with this name";
				break;
			case "invalid":
				name = seg.requested;
				tag = seg.reason;
				break;
		}
		row.createSpan({ cls: "ai-quickcap-destination-tree-name", text: name });
		row.createSpan({ cls: "ai-quickcap-destination-tree-tag", text: tag });
	}

	/** Parent path of the segment at `index`, derived from what the previous segment actually
	 *  resolved to -- used to build the same segmentChoiceKey() the resolver used, so a choice
	 *  recorded here is found again on the next resolveFolderDestination() call. */
	private parentPathForSegmentIndex(index: number): string {
		if (!this.destinationPlan || index === 0) return "";
		const prev = this.destinationPlan.segments[index - 1];
		if (!prev) return "";
		if (prev.kind === "exact") return prev.folder.path;
		if (prev.kind === "fuzzy" && prev.acknowledged) return prev.folder.path;
		if (prev.kind === "create") return prev.path;
		return "";
	}

	/** "'Lerning' may mean 'Learning'" -- the fuzzy-correction widget (brief "Fuzzy correction
	 *  display"). Every path here goes through `this.destinationChoices` and a full
	 *  recompute/re-render; nothing here silently rewrites destinationText itself. */
	private renderDestinationCorrection(container: HTMLElement, footerEl: HTMLElement, seg: Extract<SegmentResolution, { kind: "fuzzy" }>, index: number): void {
		const parentPath = this.parentPathForSegmentIndex(index);
		const key = segmentChoiceKey(index, parentPath, seg.requested);
		const box = container.createDiv({ cls: "ai-quickcap-destination-correction" });
		box.createDiv({ cls: "ai-quickcap-destination-correction-text", text: `"${seg.requested}" may mean "${seg.folder.name}"` });
		const actions = box.createDiv({ cls: "ai-quickcap-destination-correction-actions" });

		const useBtn = actions.createEl("button", { cls: "ai-quickcap-btn ai-quickcap-btn--secondary", text: `Use ${seg.folder.name}`, attr: { type: "button" } });
		useBtn.addEventListener("click", () => {
			this.destinationChoices.set(key, { segmentKey: key, resolution: { kind: "existing", path: seg.folder.path } });
			this.renderFooter(footerEl);
		});

		const chooseBtn = actions.createEl("button", { cls: "ai-quickcap-btn ai-quickcap-btn--ghost", text: "Choose another folder", attr: { type: "button" } });
		chooseBtn.addEventListener("click", () => {
			this.destinationExpandedChoice = this.destinationExpandedChoice === key ? null : key;
			this.renderFooter(footerEl);
		});

		const keepBtn = actions.createEl("button", {
			cls: "ai-quickcap-btn ai-quickcap-btn--ghost",
			text: `Keep "${seg.requested}" and create it`,
			attr: { type: "button" },
		});
		keepBtn.addEventListener("click", () => {
			this.destinationChoices.set(key, { segmentKey: key, resolution: { kind: "create", name: seg.requested } });
			this.renderFooter(footerEl);
		});

		if (this.destinationExpandedChoice === key) {
			this.renderDestinationSiblingPicker(box, footerEl, parentPath, key, seg.folder.path);
		}
	}

	/** Bounded (never whole-vault) list of the current segment's other siblings, for "Choose
	 *  another folder" -- brief: "filtered/bounded for large folders; it must not render the
	 *  entire vault." */
	private renderDestinationSiblingPicker(container: HTMLElement, footerEl: HTMLElement, parentPath: string, key: string, excludePath: string): void {
		const siblings = (this.folderSnapshot?.childrenByParent.get(parentPath) ?? []).filter((f: FolderInfo) => f.path !== excludePath);
		const box = container.createDiv({ cls: "ai-quickcap-destination-sibling-picker" });
		if (siblings.length === 0) {
			box.createDiv({ cls: "ai-quickcap-destination-hint", text: "No other folders here." });
			return;
		}
		const bounded = siblings.slice(0, 8);
		bounded.forEach((f: FolderInfo) => {
			const btn = box.createEl("button", { cls: "ai-quickcap-destination-sibling-btn", text: f.name, attr: { type: "button" } });
			btn.addEventListener("click", () => {
				this.destinationChoices.set(key, { segmentKey: key, resolution: { kind: "existing", path: f.path } });
				this.destinationExpandedChoice = null;
				this.renderFooter(footerEl);
			});
		});
		if (siblings.length > bounded.length) {
			box.createDiv({
				cls: "ai-quickcap-destination-hint",
				text: `+${siblings.length - bounded.length} more — refine your destination text to narrow this down.`,
			});
		}
	}

	/** "More than one folder could match…" -- offers at most the resolver's own bounded choice
	 *  set plus an explicit "create new folder" escape hatch (brief "Ambiguity handling"). */
	private renderDestinationAmbiguous(container: HTMLElement, footerEl: HTMLElement, seg: Extract<SegmentResolution, { kind: "ambiguous" }>, index: number): void {
		const box = container.createDiv({ cls: "ai-quickcap-destination-ambiguous" });
		const parentLabel = seg.parentPath || "vault root";
		box.createDiv({
			cls: "ai-quickcap-destination-ambiguous-text",
			text: `More than one folder could match "${seg.requested}" under ${parentLabel}. Choose where this should go.`,
		});
		const key = segmentChoiceKey(index, seg.parentPath, seg.requested);
		const actions = box.createDiv({ cls: "ai-quickcap-destination-ambiguous-actions" });

		seg.choices.forEach((choice: FolderInfo) => {
			const btn = actions.createEl("button", { cls: "ai-quickcap-btn ai-quickcap-btn--secondary", text: choice.name, attr: { type: "button" } });
			setQuickCaptureTooltip(btn, choice.path);
			btn.addEventListener("click", () => {
				this.destinationChoices.set(key, { segmentKey: key, resolution: { kind: "existing", path: choice.path } });
				this.renderFooter(footerEl);
			});
		});

		const createBtn = actions.createEl("button", {
			cls: "ai-quickcap-btn ai-quickcap-btn--ghost",
			text: `Create new folder "${seg.requested}"`,
			attr: { type: "button" },
		});
		createBtn.addEventListener("click", () => {
			this.destinationChoices.set(key, { segmentKey: key, resolution: { kind: "create", name: seg.requested } });
			this.renderFooter(footerEl);
		});

		const editBtn = actions.createEl("button", { cls: "ai-quickcap-btn ai-quickcap-btn--ghost", text: "Edit destination", attr: { type: "button" } });
		editBtn.addEventListener("click", () => this.destinationTextareaEl?.focus());
	}

	/** "Existing folder with this name" -- the requested-new-folder-leaf collision state (brief
	 *  "New-folder and collision behavior"). Never silently substitutes or creates a duplicate. */
	private renderDestinationCollision(container: HTMLElement, footerEl: HTMLElement, seg: Extract<SegmentResolution, { kind: "collision" }>, index: number): void {
		const parentPath = this.parentPathForSegmentIndex(index);
		const key = segmentChoiceKey(index, parentPath, seg.requested);
		const box = container.createDiv({ cls: "ai-quickcap-destination-collision" });
		box.createDiv({ cls: "ai-quickcap-destination-collision-text", text: "Existing folder with this name" });
		const actions = box.createDiv({ cls: "ai-quickcap-destination-collision-actions" });

		const useBtn = actions.createEl("button", { cls: "ai-quickcap-btn ai-quickcap-btn--secondary", text: "Use existing folder", attr: { type: "button" } });
		useBtn.addEventListener("click", () => {
			this.destinationChoices.set(key, { segmentKey: key, resolution: { kind: "existing", path: seg.folder.path } });
			this.renderFooter(footerEl);
		});

		const renameRow = box.createDiv({ cls: "ai-quickcap-destination-collision-rename" });
		const renameInput = renameRow.createEl("input", {
			cls: "ai-quickcap-destination-rename-input",
			attr: { type: "text", "aria-label": "Rename the new folder" },
		});
		renameInput.value = seg.requested;
		const renameBtn = renameRow.createEl("button", { cls: "ai-quickcap-btn ai-quickcap-btn--secondary", text: "Create with this name", attr: { type: "button" } });
		renameBtn.addEventListener("click", () => {
			const name = renameInput.value.trim();
			if (!name) {
				renameInput.focus();
				return;
			}
			this.destinationChoices.set(key, { segmentKey: key, resolution: { kind: "create", name } });
			this.renderFooter(footerEl);
		});

		const cancelBtn = actions.createEl("button", { cls: "ai-quickcap-btn ai-quickcap-btn--ghost", text: "Cancel", attr: { type: "button" } });
		cancelBtn.addEventListener("click", () => {
			this.destinationText = "";
			this.destinationChoices = new Map();
			this.renderFooter(footerEl);
		});
	}

	/** The note-path-level collision state (distinct from a folder collision above) -- brief: "A
	 *  target note-path collision in a non-empty destination plan must not silently append 1, 2,
	 *  etc. Offer Open existing note, Change title, and Cancel." */
	private renderDestinationNoteCollision(container: HTMLElement, footerEl: HTMLElement, notePath: string): void {
		const box = container.createDiv({ cls: "ai-quickcap-destination-collision" });
		box.createDiv({ cls: "ai-quickcap-destination-collision-text", text: `A note already exists at "${notePath}"` });
		const actions = box.createDiv({ cls: "ai-quickcap-destination-collision-actions" });

		const openBtn = actions.createEl("button", { cls: "ai-quickcap-btn ai-quickcap-btn--secondary", text: "Open existing note", attr: { type: "button" } });
		openBtn.addEventListener("click", () => {
			const file = this.plugin.app.vault.getAbstractFileByPath(notePath);
			if (file instanceof TFile) {
				this.touchSidebarNote(file.path, file.basename);
				this.activeNoteId = file.path;
				this.render();
			}
		});

		const changeTitleBtn = actions.createEl("button", { cls: "ai-quickcap-btn ai-quickcap-btn--ghost", text: "Change title", attr: { type: "button" } });
		changeTitleBtn.addEventListener("click", () => {
			this.titleInputEl?.focus();
			this.titleInputEl?.select();
		});

		const cancelBtn = actions.createEl("button", { cls: "ai-quickcap-btn ai-quickcap-btn--ghost", text: "Cancel", attr: { type: "button" } });
		cancelBtn.addEventListener("click", () => {
			this.destinationText = "";
			this.destinationChoices = new Map();
			this.renderFooter(footerEl);
		});
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
			// Successful filing means the draft is gone (or targeted elsewhere) -- any pending
			// destination plan/title for it is now moot (brief "Input lifecycle").
			this.clearDestinationState();
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

	/**
	 * See handleAdd's append-text-invariant note above -- the same treatment applies to both
	 * createNote()'s and createNoteAtDestination()'s content payload. Routes to the unchanged
	 * root-create path when the destination is blank (plan.status === "root", preserving today's
	 * numeric-suffix collision behavior exactly), and to createNoteAtDestination() for any
	 * visibly-reviewed non-empty plan otherwise. `card` is disabled/re-enabled as a whole (see
	 * setCardControlsDisabled()) since the destination sub-widgets are too dynamic to track as an
	 * explicit button list the way handleAdd's `buttons` array does.
	 */
	private async handleCreate(input: HTMLInputElement, destTextarea: HTMLTextAreaElement, card: HTMLElement, footerEl: HTMLElement): Promise<void> {
		if (this.busy) return;
		const plan = this.destinationPlan;
		if (!plan || !this.canCreateFromPlan()) return;
		const title = input.value.trim();
		if (!title) {
			input.focus();
			return;
		}
		this.busy = true;
		const textToFile = this.draftText;
		const textareaAtStart = this.draftTextarea;
		this.setCardControlsDisabled(card, true);
		if (textareaAtStart) textareaAtStart.disabled = true;
		try {
			const file =
				plan.status === "root"
					? await createNote(this.plugin.app, title, textToFile)
					: (
							await createNoteAtDestination(this.plugin.app, {
								folderPath: plan.folderPath,
								missingFolders: plan.missingFolders,
								title,
								content: textToFile,
								excludePatterns: this.plugin.settings.excludePatterns,
							})
						).file;
			this.filedHighlights.set(file.path, textToFile);
			this.touchSidebarNote(file.path, file.basename);
			if (this.draftText === textToFile) this.draftText = "";
			this.resetDecision();
			this.clearDestinationState();
			this.activeNoteId = file.path;
			this.render();
		} catch (e) {
			if (e instanceof DestinationCreateError) {
				console.error("AI Notes: failed to create note at destination", e, "createdFolders:", e.createdFolders);
				const foldersNote =
					e.createdFolders.length > 0
						? ` These folder(s) were already created and were left in place: ${e.createdFolders.join(", ")}.`
						: "";
				new Notice(`AI Notes: ${e.message}${foldersNote}`);
			} else {
				console.error("AI Notes: failed to create note", e);
				new Notice("AI Notes: couldn't create the note — see console for details.");
			}
			// Never clear the draft, destination state, or title on a failed create (brief
			// "Failure handling") -- re-rendering the (unchanged) create card both re-enables
			// every control and re-preflights the plan against whatever the vault looks like now
			// (e.g. folders createNoteAtDestination() already created before the failure).
			this.renderFooter(footerEl);
			return;
		} finally {
			this.busy = false;
		}
	}

	// ---------- manual note-search override ("Search notes instead") ----------
	//
	// A bounded, local title/path metadata search (rankNoteMetadata -- no embeddings, no
	// HybridSearch, no vault-content reads) reachable via the shared "Search instead" action on
	// every decision card (openNotePicker() above). Selecting a result always ends up at the
	// *same* Add-and-jump / Add-and-stay-here choice the confident card gives for its AI top
	// result, reusing the one shared `handleAdd` destination handler -- manual selection
	// deliberately doesn't inherit the ambiguous card's immediate single-click-jump behavior: a
	// typed query is a more deliberate act than clicking an AI-suggested candidate, so it gets
	// at least as much control, not less.

	/** Renders the picker body (search UI or a pending manual-selection confirm step) into
	 *  `container` -- the shared shell's picker region -- when open; renders nothing when
	 *  closed. The open/close trigger itself is now a normal "Search instead" action-row button
	 *  (see openNotePicker()), not owned by this method. */
	private renderNotePickerBody(container: HTMLElement, footerEl: HTMLElement): void {
		if (!this.isNotePickerOpen) return;
		if (this.notePickerSelection) this.renderNotePickerConfirm(container, footerEl);
		else this.renderNotePickerSearch(container, footerEl);
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
			attr: { type: "button", "aria-label": "Close search" },
			text: "×",
		});
		setQuickCaptureTooltip(closeBtn, "Close search");

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
				attr: { role: "option", "aria-selected": String(i === this.highlightedResultIndex) },
			});
			setQuickCaptureTooltip(row, item.path);
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
		const confirmTitle = confirm.createDiv({ cls: "ai-quickcap-card-title", text: selection.title });
		setQuickCaptureTooltip(confirmTitle, selection.path);

		// Distinct class from the shared decision-shell's `.ai-quickcap-actions` (that one is now
		// a two-group start/end row via CSS -- this is its own small, separate, flat action row).
		const actions = confirm.createDiv({ cls: "ai-quickcap-picker-confirm-actions" });
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
