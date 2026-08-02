import {
	DestinationParse,
	FolderSegmentSuggestion,
	FolderSnapshot,
	joinFolderPath,
	findExactSibling,
	suggestFolderSegment,
	validateSegmentName,
} from "./FolderDestination";

/**
 * One committed folder token in the "Create at" composer
 * (progressive-destination-composer-addendum.md "View-local state"). `requested` is always the
 * exact spelling the user typed/accepted; `name`/`path` are the canonical vault spelling for an
 * "existing" token (may differ from `requested` when it was a fuzzy correction) or the verbatim
 * requested spelling for a "create" token (never fuzzy-corrected).
 */
export interface ComposerFolderToken {
	requested: string;
	name: string;
	path: string;
	disposition: "existing" | "create";
	correctedFrom?: string;
}

export interface ProgressiveDestinationComposerOptions {
	/** Rebuilds a fresh FolderSnapshot from live vault state -- called at the boundaries the
	 *  addendum's "Performance" section calls out (mount/focus, token commit, before final
	 *  creation), never on every keystroke. */
	buildSnapshot: () => FolderSnapshot;
	/** Fired on every state change that should refresh the caller's plan preview / Create-button
	 *  gating (token committed/reopened, active text changed, disabled state doesn't trigger this).
	 *  Deliberately re-settable via setOnChange() -- the caller's decision card is torn down and
	 *  rebuilt on every unrelated re-render (e.g. toggling "Search instead"), so a callback
	 *  captured only at construction time would close over stale, already-removed DOM. */
	onChange: () => void;
	/** The vault's actual config-folder name (`Vault#configDir` -- usually ".obsidian" but
	 *  user-configurable), threaded down into validateSegmentName()'s reserved-name check.
	 *  Optional so pure-logic/test call sites can omit it and fall back to the ordinary default;
	 *  every real caller with a live `App` should pass `app.vault.configDir`. */
	configDir?: string;
}

/**
 * The progressive, root-first "Create at" composer: one native `<input>` for the active
 * folder-or-title text, plus committed folder tokens rendered as chips with `/` separators.
 * Replaces the old separate "New note title" input and freeform "Describe destination" textarea
 * (progressive-destination-composer-addendum.md). Owns its own DOM and keyboard/paste/IME
 * handling; `QuickCaptureView` only reads its committed state via getFolders()/getActiveText()/
 * buildDestinationParse() and calls refreshSnapshot() at the boundaries above.
 *
 * Deliberately NOT contenteditable -- a native input gives safer selection, clipboard, keyboard,
 * screen-reader, and IME behavior (addendum "Input component architecture").
 */
export class ProgressiveDestinationComposer {
	private folders: ComposerFolderToken[] = [];
	private activeText = "";
	private suggestion: FolderSegmentSuggestion = { kind: "empty" };
	private snapshot: FolderSnapshot;
	private isComposing = false;
	private suggestionDismissed = false;
	private disabled = false;

	private readonly buildSnapshot: () => FolderSnapshot;
	private onChange: () => void;
	private readonly configDir: string;
	private readonly rootEl: HTMLElement;
	private readonly fieldEl: HTMLElement;
	private readonly messageEl: HTMLElement;
	private readonly inputEl: HTMLInputElement;

	constructor(opts: ProgressiveDestinationComposerOptions) {
		this.buildSnapshot = opts.buildSnapshot;
		this.onChange = opts.onChange;
		this.configDir = opts.configDir ?? ".obsidian";
		this.snapshot = this.buildSnapshot();

		// Free-standing createDiv()/createEl() (not document.createElement) -- Obsidian's own
		// detached-element helpers, which work fine before this.rootEl has any parent (it's
		// mounted into a real container later via mount()).
		this.rootEl = createDiv({ cls: "ai-quickcap-composer" });
		this.fieldEl = this.rootEl.createDiv({ cls: "ai-quickcap-composer-field" });
		this.inputEl = createEl("input", {
			cls: "ai-quickcap-composer-input",
			attr: {
				type: "text",
				"aria-label": "Create at",
				placeholder: "Type a folder or note title…",
				spellcheck: "false",
			},
		});
		this.messageEl = this.rootEl.createDiv({ cls: "ai-quickcap-composer-message" });

		this.wireInput();
		this.renderTokensAndInput();
		this.updateMessage();
	}

	// ---------- public API for QuickCaptureView ----------

	/** Moves (never recreates) the composer's DOM into `container` -- safe to call on every
	 *  re-render of the card that hosts it, including the very first mount. */
	mount(container: HTMLElement): void {
		container.appendChild(this.rootEl);
	}

	/** Re-points the state-change callback at the current render's closure -- see the doc comment
	 *  on ProgressiveDestinationComposerOptions.onChange for why this must be re-settable. */
	setOnChange(cb: () => void): void {
		this.onChange = cb;
	}

	getFolders(): readonly ComposerFolderToken[] {
		return this.folders;
	}

	getActiveText(): string {
		return this.activeText;
	}

	/** Rebuilds the live folder snapshot -- call on token commit and immediately before final
	 *  creation, per the addendum's performance boundaries. Mount-time and focus-time refreshes
	 *  are handled internally. */
	refreshSnapshot(): void {
		this.snapshot = this.buildSnapshot();
		this.recomputeSuggestion();
		this.updateMessage();
	}

	/** Converts committed tokens + active text into the same `DestinationParse` shape the
	 *  original parser produced, so the unchanged whole-plan resolver can revalidate everything
	 *  in one pass before creation (addendum "Final-plan adapter"). A single trailing `.md` on
	 *  the active text is stripped before it becomes the title. */
	buildDestinationParse(): DestinationParse {
		const segments = this.folders.map((t) => ({
			name: t.disposition === "existing" ? t.name : t.requested,
			intent: (t.disposition === "existing" ? "resolve-or-create" : "create-new") as "resolve-or-create" | "create-new",
		}));
		let title = this.activeText.trim();
		if (/\.md$/i.test(title)) title = title.slice(0, -3).trim();
		return { segments, explicitTitle: title || null, confidence: "structured", warnings: [] };
	}

	setDisabled(disabled: boolean): void {
		this.disabled = disabled;
		this.inputEl.disabled = disabled;
		this.rootEl.querySelectorAll<HTMLButtonElement>("button").forEach((b) => (b.disabled = disabled));
	}

	/** Replaces the active text programmatically (e.g. "Change title" populating an inferred
	 *  title so the user has real text to edit) and focuses/selects it. */
	setActiveText(text: string): void {
		this.activeText = text;
		this.inputEl.value = text;
		this.recomputeSuggestion();
		this.updateMessage();
		this.inputEl.focus();
		this.inputEl.select();
	}

	focus(): void {
		this.inputEl.focus();
	}

	destroy(): void {
		this.rootEl.remove();
	}

	// ---------- internal: rendering ----------

	private currentParentPath(): string {
		const last = this.folders.at(-1);
		return last ? last.path : "";
	}

	private recomputeSuggestion(): void {
		this.suggestion = suggestFolderSegment(this.activeText, this.currentParentPath(), this.snapshot);
		this.suggestionDismissed = false;
	}

	/** Rebuilds token chips + separators + the (never-recreated) active input. Only called when
	 *  the committed token list itself changes -- not on every keystroke (that only touches
	 *  updateMessage()), so focus/caret in the active input is never disturbed mid-typing. */
	private renderTokensAndInput(): void {
		this.fieldEl.empty();
		this.folders.forEach((token, i) => {
			const chip = this.fieldEl.createEl("button", {
				cls: "ai-quickcap-composer-token" + (token.disposition === "create" ? " is-new" : " is-existing"),
				attr: { type: "button", "aria-label": `Edit ${token.name}` },
			});
			chip.createSpan({ cls: "ai-quickcap-composer-token-name", text: token.name });
			if (token.disposition === "create") chip.createSpan({ cls: "ai-quickcap-composer-token-badge", text: "new" });
			chip.title = token.correctedFrom ? `Corrected from "${token.correctedFrom}"` : token.disposition === "create" ? "Will be created" : "Existing folder";
			chip.addEventListener("click", () => this.reopenTokenAt(i));
			this.fieldEl.createSpan({ cls: "ai-quickcap-composer-sep", text: "/" });
		});
		this.inputEl.value = this.activeText;
		this.inputEl.disabled = this.disabled;
		this.fieldEl.appendChild(this.inputEl);
	}

	private updateMessage(): void {
		this.messageEl.empty();
		if (this.suggestionDismissed) return;

		const s = this.suggestion;
		if (s.kind === "exact") {
			const row = this.messageEl.createDiv({ cls: "ai-quickcap-composer-hint" });
			row.createSpan({ text: `${s.folder.name} — Tab to use` });
			const btn = row.createEl("button", { cls: "ai-quickcap-btn ai-quickcap-btn--ghost", text: `Use ${s.folder.name}`, attr: { type: "button" } });
			btn.addEventListener("click", () => this.commitAccept());
			return;
		}
		if (s.kind === "fuzzy") {
			const row = this.messageEl.createDiv({ cls: "ai-quickcap-composer-hint" });
			row.createSpan({ text: `Suggested folder: ${s.folder.name} — Tab to use` });
			const actions = this.messageEl.createDiv({ cls: "ai-quickcap-composer-hint-actions" });
			const useBtn = actions.createEl("button", { cls: "ai-quickcap-btn ai-quickcap-btn--ghost", text: `Use ${s.folder.name}`, attr: { type: "button" } });
			useBtn.addEventListener("click", () => this.commitAccept());
			const createBtn = actions.createEl("button", { cls: "ai-quickcap-btn ai-quickcap-btn--ghost", text: `Create "${s.requested}"`, attr: { type: "button" } });
			createBtn.addEventListener("click", () => this.commitActiveAsSlash());
			return;
		}
		if (s.kind === "ambiguous") {
			const parentPath = this.currentParentPath();
			const parentLabel = parentPath || "vault root";
			this.messageEl.createDiv({
				cls: "ai-quickcap-composer-hint",
				text: `More than one folder matches "${s.requested}" under ${parentLabel}. Keep typing to narrow it, or press "/" to create "${s.requested}".`,
			});
			return;
		}
		if (s.kind === "none" && this.folders.length === 0 && this.activeText.trim() === s.requested) {
			// No matching/creatable folder context yet worth calling out at the very first
			// segment -- stay quiet rather than narrating every keystroke.
			return;
		}
	}

	private validationErrorFor(name: string): string | null {
		return validateSegmentName(name, this.configDir);
	}

	private showError(message: string): void {
		this.messageEl.empty();
		this.messageEl.createDiv({ cls: "ai-quickcap-composer-error", text: message });
	}

	// ---------- internal: commit actions ----------

	private commitToken(token: ComposerFolderToken): void {
		this.folders = [...this.folders, token];
		this.activeText = "";
		this.refreshSnapshot(); // also updates the message region for the now-empty active text
		this.renderTokensAndInput();
		this.inputEl.focus();
		this.onChange();
	}

	/** Tab / Enter / Right-Arrow-at-end / pointer "Use X" acceptance of the current unique
	 *  suggestion (exact or fuzzy). No-ops if there is no unique suggestion to accept. */
	private commitAccept(): void {
		const s = this.suggestion;
		if (s.kind === "exact") {
			this.commitToken({ requested: this.activeText.trim(), name: s.folder.name, path: s.folder.path, disposition: "existing" });
		} else if (s.kind === "fuzzy") {
			this.commitToken({
				requested: this.activeText.trim(),
				name: s.folder.name,
				path: s.folder.path,
				disposition: "existing",
				correctedFrom: s.requested,
			});
		}
	}

	/** `/`, and the fuzzy/ambiguous "Create …" affordances: commits the active text as a new
	 *  folder segment unless a normalized exact sibling exists, in which case that existing
	 *  folder is used instead -- never fuzzy-corrected (addendum "Explicit new folder"). */
	private commitActiveAsSlash(): void {
		const text = this.activeText.trim();
		if (!text) return;
		const err = this.validationErrorFor(text);
		if (err) {
			this.showError(err);
			return;
		}
		const exact = findExactSibling(text, this.currentParentPath(), this.snapshot);
		if (exact) {
			this.commitToken({ requested: text, name: exact.name, path: exact.path, disposition: "existing" });
		} else {
			this.commitToken({ requested: text, name: text, path: joinFolderPath(this.currentParentPath(), text), disposition: "create" });
		}
	}

	/** Backspace on an empty active input, or clicking a committed token: reopens that segment
	 *  for editing, discarding any tokens after it (addendum "Users must be able to... press
	 *  Backspace on an empty active input to reopen the preceding token"; "click a committed
	 *  token to edit it"). */
	private reopenTokenAt(index: number): void {
		if (this.disabled) return;
		const token = this.folders[index];
		if (!token) return;
		this.folders = this.folders.slice(0, index);
		this.activeText = token.requested;
		this.refreshSnapshot(); // also updates the message region for the reopened token's text
		this.renderTokensAndInput();
		this.inputEl.focus();
		this.inputEl.setSelectionRange(this.activeText.length, this.activeText.length);
		this.onChange();
	}

	// ---------- internal: input wiring ----------

	private wireInput(): void {
		this.inputEl.addEventListener("compositionstart", () => {
			this.isComposing = true;
		});
		this.inputEl.addEventListener("compositionend", () => {
			this.isComposing = false;
			// Recompute once, now that the composed text is final (IME requirement: never
			// tokenize/autocomplete/rewrite mid-composition).
			this.activeText = this.inputEl.value;
			this.recomputeSuggestion();
			this.updateMessage();
			this.onChange();
		});

		this.inputEl.addEventListener("input", () => {
			if (this.isComposing) return;
			this.activeText = this.inputEl.value;
			this.recomputeSuggestion();
			this.updateMessage();
			this.onChange();
		});

		this.inputEl.addEventListener("keydown", (evt: KeyboardEvent) => {
			// isComposing (tracked via compositionstart/compositionend below) already covers IME
			// composition state -- no need for the deprecated evt.keyCode === 229 fallback too.
			if (this.isComposing) return;

			if (evt.key === "/") {
				evt.preventDefault();
				this.commitActiveAsSlash();
				return;
			}
			if (evt.key === "Tab") {
				if (this.suggestion.kind === "exact" || this.suggestion.kind === "fuzzy") {
					evt.preventDefault();
					this.commitAccept();
				}
				// No suggestion: let Tab move focus normally.
				return;
			}
			if (evt.key === "Enter") {
				// Enter inside the composer must never submit/create.
				evt.preventDefault();
				if (this.suggestion.kind === "exact" || this.suggestion.kind === "fuzzy") this.commitAccept();
				return;
			}
			if (evt.key === "ArrowRight") {
				const atEnd = this.inputEl.selectionStart === this.inputEl.value.length && this.inputEl.selectionEnd === this.inputEl.value.length;
				if (atEnd && (this.suggestion.kind === "exact" || this.suggestion.kind === "fuzzy")) {
					evt.preventDefault();
					this.commitAccept();
				}
				return;
			}
			if (evt.key === "Backspace") {
				if (this.inputEl.value.length === 0 && this.folders.length > 0) {
					evt.preventDefault();
					this.reopenTokenAt(this.folders.length - 1);
				}
				return;
			}
			if (evt.key === "Escape") {
				this.suggestionDismissed = true;
				this.updateMessage();
			}
		});

		this.inputEl.addEventListener("focus", () => this.refreshSnapshot());

		this.inputEl.addEventListener("paste", (evt: ClipboardEvent) => {
			if (this.isComposing) return;
			const text = evt.clipboardData?.getData("text");
			if (!text || !text.includes("/")) return; // plain paste: let the browser insert it normally
			evt.preventDefault();
			this.handleSlashPaste(text);
		});
	}

	/** Slash-separated paste (addendum "Paste behavior"): resolves folder segments in order,
	 *  sibling-by-sibling, stopping visibly (leaving the remainder as plain active text) at the
	 *  first segment that isn't an exact match -- a fuzzy/ambiguous/no-match result is never
	 *  auto-applied just because it arrived via paste. */
	private handleSlashPaste(raw: string): void {
		const endsWithSlash = /\/\s*$/.test(raw);
		const rawParts = raw.split("/").map((p) => p.trim());
		const parts = endsWithSlash ? rawParts.filter((p) => p.length > 0) : rawParts;
		if (parts.length === 0) return;

		const folderParts = endsWithSlash ? parts : parts.slice(0, -1);
		const titlePart = endsWithSlash ? "" : (parts.at(-1) ?? "");

		let stoppedAt = -1;
		for (let i = 0; i < folderParts.length; i++) {
			const part = folderParts[i];
			if (!part) continue;
			const err = this.validationErrorFor(part);
			if (err) {
				stoppedAt = i;
				break;
			}
			const parentPath = this.currentParentPath();
			const suggestion = suggestFolderSegment(part, parentPath, this.snapshot);
			if (suggestion.kind === "exact") {
				this.folders = [...this.folders, { requested: part, name: suggestion.folder.name, path: suggestion.folder.path, disposition: "existing" }];
			} else {
				stoppedAt = i;
				break;
			}
		}

		if (stoppedAt === -1) {
			this.activeText = titlePart;
		} else {
			// Leave the unresolved remainder (from the stopping segment onward) as plain typed
			// text for the user to resolve manually -- never auto-create/auto-correct from paste.
			this.activeText = folderParts.slice(stoppedAt).concat(endsWithSlash ? [] : [titlePart]).join("/");
		}

		this.refreshSnapshot(); // also updates the message region for the pasted remainder
		this.renderTokensAndInput();
		this.inputEl.focus();
		this.inputEl.setSelectionRange(this.activeText.length, this.activeText.length);
		this.onChange();
	}
}
