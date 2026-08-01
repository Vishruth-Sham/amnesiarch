# Technical Review — Quick Capture redesign

## Verdict

**CHANGES REQUESTED / NOT READY.** The architectural direction is sound and the code builds, but two async interaction races can route or erase text, and the implementation does not satisfy the repository's append-text invariant despite claiming that it does. These are release blockers; the remaining findings are focused corrections rather than grounds for a rewrite.

Verification in this review: inspected the original Implementation Brief, Completion Report, full working-tree diff, and affected backend services; independently ran `npx tsc --noEmit -p .`, `node esbuild.config.mjs production`, and `git diff --check` successfully. No Obsidian GUI click-through was possible, so layout, focus, actual workspace placement, and rendered highlight behavior remain unverified.

## Criteria satisfied

- The old chat surface is replaced by a vanilla-TypeScript Quick Capture view with the specified two-pane structure, pinned Quick Capture entry, textarea, example chips, Sort action, and three routing cards.
- Automatic routing reuses `embedText()`, `search()`, `MIN_CONFIDENCE`, and `MIN_MARGIN` with the same threshold/margin comparisons (`src/view/QuickCaptureView.ts:263-284`, `140-150`).
- The main action sets and state transitions match the design: confident Add-and-jump/Add-and-stay/Keep-editing; ambiguous candidate selection/New-note/Keep-editing; create-and-jump/Back.
- Quick Capture remains ephemeral view-local state. The sidebar is session-bounded rather than a full-vault browser.
- Filing and creation reuse the existing services. No new model, network, indexing, or persistence architecture was introduced.
- The view is opened with a main-area leaf (`main.ts:105-115`), not deliberately placed in the right sidebar.
- The destination view is static and attempts to highlight the last filed content.
- The style block adopts the supplied design tokens and documents the visual-direction change.
- Deleting `ChatView.ts`, updating the source imports, and renaming the class/symbol are internally consistent; source grep/build found no stale TypeScript reference.
- The Implementer accurately limited its verification claim to compilation/bundling and code tracing. The successful checks prove type/bundle integrity, not working GUI behavior.

## Criteria not satisfied

### 1. Append-text invariant — blocking

The brief requires the exact text typed by the user to land in the destination. Both Quick Capture write paths trim the draft before passing it on (`QuickCaptureView.ts:386`, `413`), then both existing services trim it again (`src/append/AppendService.ts:10`, `src/create/CreateNoteService.ts:42`). Leading/trailing spaces and blank lines are therefore silently rewritten.

The Completion Report's statement that `this.draftText.trim()` is “verbatim” is incorrect. Using `trim()` for the empty-input check and embedding query is fine; using it for the write payload is not.

### 2. Sort results can be stale relative to the draft — blocking

`handleSort()` snapshots a trimmed query, awaits embedding/search, and then unconditionally installs those results (`QuickCaptureView.ts:263-284`). The textarea remains enabled. If the user edits while sorting, the input handler clears the decision, but the older async completion subsequently sets `sorted = true` and shows a destination computed for the old text while the card will file the new text.

This can target the wrong note under normal impatient-user behavior. The global `busy` boolean prevents another Sort call but does not prevent draft edits or reject a stale completion.

### 3. Edits during append/create can be erased — blocking

The textarea remains editable after Add/Create begins. `handleAdd()` and `handleCreate()` snapshot the old draft, await disk I/O, then unconditionally clear `this.draftText` and rerender (`QuickCaptureView.ts:381-429`). If the user types while the write is in flight, their new text is cleared on success. This is direct data loss in the ephemeral draft.

The title input also remains editable during create even though the handler has already captured its value, so late edits can appear accepted but are ignored.

### 4. Empty-index behavior was not carried forward honestly

The original brief explicitly called for the equivalent of “No notes indexed yet.” `computePhase()` folds zero results into the low-confidence create state and renders “No confident match — new note” (`QuickCaptureView.ts:140-146`, `350-358`). With an empty or still-building cache, no match was evaluated; the copy is misleading and hides the fact that search coverage is absent or incomplete.

The same create-card chrome/actions can be reused, but the reason/copy must be distinct. This does not require inventing a visually different fourth design.

### 5. Draft-dependent title state is stale across resets

`resetDecision()` does not clear `newTitleOverride` (`QuickCaptureView.ts:129-133`). After the user edits the proposed title, chooses Back/Keep editing, changes the draft, and later reaches create again, the previous draft's title wins over `proposeTitle(newDraft)` (`QuickCaptureView.ts:358-360`). The title is visible before confirmation, so this is not silent corruption, but it is a realistic wrong-default bug.

## Bugs and risks

### High

1. **Stale routing result after editing during Sort.** A destination calculated for draft A can be shown and used to append draft B.
2. **Draft loss after editing during Add/Create.** New keystrokes entered while I/O is pending are cleared when the older operation succeeds.
3. **Append payload is transformed.** `.trim()` violates a locked product invariant on both append and create paths.

### Medium

4. **Empty/incomplete index is presented as an AI no-match.** This undermines confidence framing and can steer a user to create a duplicate note while indexing is still underway.
5. **Stale `newTitleOverride`.** A title edited for one draft can be offered for a later draft.
6. **Read failure is rendered as “This note is empty.”** `renderDestinationNote()` logs a failed `cachedRead()` but continues with empty content (`QuickCaptureView.ts:441-453`). The UI should say the note could not be loaded, not make a false content claim.
7. **The highlight matcher can highlight the wrong occurrence, not merely fail closed.** `findHighlightRange()` searches backward through the whole rendered note (`QuickCaptureView.ts:45-61`). If sync/external editing removes or alters the newly appended copy but an older identical block remains, the older block is highlighted. This is a correctness issue beyond the Completion Report's disclosed “no highlight” degradation.

### Low

8. Sidebar and ambiguous candidate rows are clickable `<div>` elements (`QuickCaptureView.ts:167-176`, `324-330`) with no keyboard semantics or focus state. Use buttons, or add role/tabindex/Enter/Space behavior and focus-visible styling.
9. Renaming the command ID from `open-ai-notes-chat` to `open-quick-capture` (`main.ts:31-35`) can silently discard users' assigned hotkeys. The visible name should change; the stable command ID should normally remain.
10. Renaming the persisted view-type string can leave an old `ai-notes-chat-view` leaf in saved workspace layouts. The new semantic view type is reasonable, but it needs explicit legacy-leaf cleanup/migration.
11. `package-lock.json` normalization is unrelated to the feature. It removes a root dependency entry that was already absent from `package.json`; the package remains transitively locked. Revert this diff unless the lockfile cleanup is intentionally approved separately.

## Answers to the Implementer's six review questions

1. **Empty index folded into no-match:** Not acceptable as written. Reuse the same create card, but distinguish `no-results-because-cache-empty/indexing` from `top-below-confidence` and use honest copy. The brief explicitly required the old empty-index case to survive.
2. **Indexing badge removed:** Dropping a permanent header badge is acceptable because the approved design has no slot. However, while `indexer.isIndexing()` is true, Sort decisions should include a minimal quiet warning that results may be incomplete; the zero-result state must say indexing/empty index rather than “No confident match.” This can be read at Sort/render time without claiming the indexer's single callback slot.
3. **View-type rename:** Renaming the TypeScript symbol/class is right. A new persisted view-type string is defensible because reusing the old type could resurrect Quick Capture in a saved right-sidebar leaf, but add cleanup for legacy leaves; separately preserve the existing command ID so hotkeys survive.
4. **`@tag` dropped:** Acceptable for this diff because the brief explicitly put it out of scope and required it to be reported. The queued live-search override is the correct replacement; do not reintroduce `@tag` here.
5. **`lastResults`:** Fine and necessary. The brief's state list was minimal, not exhaustive. The concern is not the field but invalidating it against async stale completions; add a draft revision/request token or disable editing and verify the snapshot before assigning it.
6. **`findHighlightRange`:** There is one additional correctness issue: the backward whole-note search may highlight an older identical block after the fresh block changes/disappears. Prefer a tail-anchored exact check (the service always appends) and return no highlight if the expected block is not at the append boundary; do not search older content.

## Architectural consistency

The implementation is appropriately contained in one view plus styles and reuses the intended backend. `lastResults` is a normal, justified representation of the most recent automatic decision. `busy` is also reasonable, but its current UI boundary is incomplete: it guards handlers without freezing/revision-checking the input state whose mutation changes the meaning of those operations.

The one-file view is 483 lines but remains coherent for this repository's existing vanilla-DOM style. Do not split it merely for size during this correction. The planned live-search override may justify extracting a reusable decision-card picker later, but that follow-up should not be pulled into this patch.

## Unnecessary complexity

- No major architectural overengineering was introduced.
- The `sanitizeExcerpt()`/tail excerpt carryover is modest and useful, though it was not central to the handoff.
- Updating `README.md` and the `ProfileCache` comment is sensible consistency work.
- The lockfile-only root dependency normalization is unrelated and should be dropped or separately justified.
- Do not add a multi-listener indexer event system solely to restore progress UI; a render-time `isIndexing()` warning is sufficient for this feature.

## Missing tests and unproven behavior

Build/typecheck do not prove the interaction state machine. No automated tests exist, so the following remain unverified until a human runs Obsidian:

- actual main-area opening and behavior on repeated command/ribbon activation
- two-pane width, overflow, fixed-dark rendering, focus, and `oklch()` appearance
- every confident/ambiguous/create action and retry state
- edit-during-sort and edit-during-write behavior after correction
- exact preservation of leading/trailing whitespace and blank lines on disk
- duplicate-content highlight behavior
- session sidebar order/navigation and destination rendering for long/Unicode/renamed/deleted notes
- empty vault, first index in progress, partial progressive index, and completed index copy
- keyboard access for sidebar/candidate rows

The Implementer should not add a test framework solely for this patch, but the async races are suitable for small extracted state-transition tests if a harness is introduced later.

## Exact corrections required

1. Introduce one `setBusy()`/operation-boundary helper that disables the Quick Capture textarea and all controls relevant to Sort/Add/Create while the operation is in flight, then restores them on failure. Also capture a draft revision or exact snapshot and refuse to install Sort results if the draft changed; this defensive check is required even if the textarea is disabled.
2. Use `draftText.trim()` only to reject whitespace-only input and to form the embedding query. Pass the unmodified `draftText` as the append/create content payload.
3. Update `appendToNote()` and `createNote()` so they do not call `.trim()` on content. They may add structural separator/final newlines, but the user payload itself must remain a verbatim substring. Add code-trace examples for leading spaces, trailing spaces, a leading blank line, and a trailing blank line.
4. Clear `newTitleOverride` whenever the draft changes or the decision is abandoned/restarted. Seed it from `proposeTitle(currentDraft)` only when entering create for that draft.
5. Distinguish an empty/incomplete cache from low confidence. Reuse the card styling and title input, but show truthful copy and, when `indexer.isIndexing()` is true, state that results may be incomplete. No persistent header badge is required.
6. On destination read failure, show “Couldn't load this note” (and optionally a Notice) and return; do not fall through to “This note is empty.”
7. Change highlight detection to validate only the expected appended block at the file tail/known append boundary. If it is not there, render without a highlight; never scan backward and highlight an older duplicate.
8. Render sidebar and candidate rows as `<button type="button">` elements styled like the design, or supply equivalent keyboard semantics and focus-visible treatment.
9. Preserve the old command ID while changing its visible name, and explicitly detach/migrate legacy `ai-notes-chat-view` leaves when adopting the new view-type string.
10. Revert the unrelated `package-lock.json` diff unless the Manager intentionally includes lockfile normalization in this change.
11. Re-run TypeScript, production build, and `git diff --check`, then perform the manual script below. Do not mark the change READY until GUI-dependent primary journeys are manually confirmed.

## Revised Claude Code handoff

### Objective

Correct the Quick Capture implementation without redesigning or broadly refactoring it. Preserve the accepted two-pane UI and backend reuse.

### Required implementation

- Fix the three blocking draft/write problems: stale Sort completion, editable draft during pending write, and payload trimming.
- Reset draft-derived title state correctly.
- Preserve the create-card design while adding truthful empty/indexing copy.
- Make destination read/highlight failure safe and honest.
- Restore stable command/workspace migration behavior and keyboard semantics with minimal changes.

### Acceptance criteria

- Editing cannot produce a decision for an older draft, and no keystroke entered during an operation can be erased.
- The original draft is present verbatim within the destination file for append and create, including leading/trailing whitespace and blank lines.
- Empty/in-progress indexing is never described as a confidence judgment over a complete search.
- A changed/missing appended block produces no highlight, never a highlight on an older duplicate.
- Read failure is not shown as an empty note.
- Existing user hotkeys survive the label rename; stale saved chat leaves are cleaned up or explicitly migrated.
- Sidebar/candidate rows are keyboard operable.
- `tsc`, production esbuild, and `git diff --check` pass.

### Manual verification script

1. Reload the plugin in the real dev vault and open Quick Capture twice via command/ribbon; verify one main-area view is revealed and no obsolete right-sidebar leaf remains.
2. Verify empty chips, text editing, Sort, and all confident/ambiguous/create actions visually against the prototype.
3. During a deliberately slow Sort, attempt to edit. Confirm either editing is disabled or the old result is discarded; a destination for the old draft must never appear for the new draft.
4. During Add/Create, attempt to edit the draft/title. Confirm pending-operation state is clear and no new input can be lost or falsely accepted.
5. Append and create text containing leading spaces, trailing spaces, and blank first/last lines; inspect the files and confirm the payload is verbatim and not duplicated.
6. Edit a proposed title, Back out, change the draft, and sort to create again; confirm a fresh title is proposed.
7. Test zero indexed notes and indexing in progress; verify the copy explains the actual state. Then test a genuine below-confidence result.
8. File text that already exists elsewhere in the destination, then alter/remove the newly appended copy before rendering if practical; confirm no older occurrence is highlighted.
9. Use keyboard only to activate sidebar and ambiguous candidates.
10. Force or simulate a note read failure and confirm the UI does not call it empty.

## Recommendation

Return to the Implementer for the focused correction pass above. After static review is clean, route to Product Testing for code-trace plus the required 5–10 minute human Obsidian script; the present build is not ready for approval.
