# Implementation Brief

## Objective

Apply the in-scope Quick Capture design improvements from `design_change/` to the current, corrected UI:

1. replace detached/native tooltips with one anchored tooltip component;
2. make confident, ambiguous, and create/no-match decisions read as states of one shared sort panel;
3. replace raw hybrid-search percentages with relative match-strength bars and a top-result “best match” label;
4. standardize decision actions, including **Search instead** and a far-right **Keep editing** escape action;
5. make the empty capture field visibly ready for input; and
6. disable browser spellcheck on the capture textarea.

Do not implement the icon-rail/sidebar proposal in design issue #1. It describes Obsidian application chrome that this plugin does not render, not the plugin's 180px session-note sidebar.

## Context

This brief targets the current post-correction implementation on `origin/main`, not the earlier `ChatView` or first Quick Capture draft. The current view already includes:

- ephemeral Quick Capture draft state;
- the corrected async/write guards and verbatim append behavior;
- confident, ambiguous, low-confidence, empty-index, and force-create decision states;
- a session-only note sidebar;
- the metadata-only **Search notes instead** picker backed by `rankNoteMetadata()`;
- retryable append/create behavior and local-only search.

Preserve those behaviors. This is a focused component and visual-coherence pass, not a search, indexing, routing, or persistence redesign.

Sources of truth:

- `design_change/quick-capture-design-improvements.md`: requested problems, fixes, and sprint priority.
- `design_change/sort_panel_redesign.html`: reference for candidate rows, relative bars, top-result emphasis, divider, and action hierarchy. It is not production code.
- `design_change/no_match_panel_redesign.html`: reference for the create state and consistent escape action. It is not production code.
- `src/view/QuickCaptureView.ts`: current state machine and behavior.
- `src/search/NotePicker.ts`: current manual-search ranking; behavior remains unchanged.
- `styles.css`: existing Quick Capture tokens and component styles.
- `CLAUDE.md`: local-first, append-text, simple-product, and manual-GUI-verification constraints.

## User-facing behavior

### Anchored tooltips

- Quick Capture controls that need explanatory or truncation text show one custom tooltip next to the hovered or keyboard-focused trigger.
- The tooltip is centered above the trigger by default, flips below when there is insufficient space, stays inside the Quick Capture viewport, and has a small pointer aimed at the trigger.
- It disappears on pointer leave, blur, Escape, view rerender/removal, or view close. It must never remain detached near the bottom of the viewport.
- The capture textarea and new-note title input retain their accessible names and receive correctly anchored “Quick capture note” and “New note title” descriptions, matching the two reported failures.
- Truncated note/path affordances and the icon-only search-close button use the same component.
- Native `title` attributes are removed from migrated targets so the browser cannot show a second, unpositionable tooltip.

### Quick Capture empty state

- The empty textarea placeholder becomes **“Summarize this document”**.
- The view continues to focus the textarea when Quick Capture opens or is revisited.
- The insertion caret uses the violet accent and is visible immediately.
- The focused textarea gets a quiet but unmistakable focus treatment at its actual boundary; it must not look disabled or introduce a heavy card inside the editor.
- Placeholder contrast increases from the current `rgba(255,255,255,.3)` to approximately `.45`, subject to manual visual comparison in Obsidian.
- The textarea sets `spellcheck="false"`; shorthand and fragments do not show browser red squiggles.

### Unified sort panel

All decision variants use the same component anatomy and occupy the same footer position:

```text
decision card
  status/header copy
  result-specific content
    confident: top note row + excerpt
    ambiguous: up to three candidate rows
    create/no-match: editable proposed-title field
    optional: indexing warning and/or open note picker
  divider
  action row
    destination action(s), if available
    Create new note, if not already in create state
    Search instead
    flexible spacer
    Keep editing
```

The card background, border, 12px radius, padding, content spacing, divider, and action row are shared rather than independently recreated by each state.

Action behavior and order:

- **Confident:** **Add and jump** → **Add and stay here** → **Create new note** → **Search instead** → spacer → **Keep editing**.
- **Ambiguous:** **Use “{top title}”** → **Create new note** → **Search instead** → spacer → **Keep editing**. Candidate rows remain directly selectable and keep their existing immediate add-and-jump behavior; the new primary action makes the recommended top path obvious without adding a new selection state.
- **Create/no-match/empty-index:** **Create and jump** → **Search instead** → spacer → **Keep editing**.
- **Keep editing** always performs the current decision reset without changing the draft. The create card's ambiguous **Back** label is replaced with **Keep editing**.
- The manual picker's internal **Back** button remains **Back**, because it returns from a chosen manual destination to that picker's results rather than abandoning the overall decision.
- **Create new note** from confident or ambiguous enters the existing force-create state and seeds `proposeTitle(draftText)`; it does not create until the user confirms.
- Remove the current flex-fill treatment that makes **+ New note instead** look primary. Use **Create new note** consistently in the shared action row.

### Relative match-strength treatment

- Do not display raw hybrid-search percentages anywhere in the decision cards. They are ranking scores, not calibrated user confidence.
- Confident and ambiguous result rows share one visual treatment: title, a small horizontal relative-strength track, and optional top-result label.
- The first result has the accent border/background treatment and the text label **“best match”**.
- Other rows use muted bars and no numeric label.
- Bar width is relative to the visible top result, not an asserted probability:

```ts
topScore = Math.max(visibleResults[0]?.score ?? 0, Number.EPSILON)
widthPercent = clamp((Math.max(score, 0) / topScore) * 100, 10, 100)
```

- For a single confident result, the bar is full width and the “best match” label carries the meaning; do not invent an absolute confidence claim.
- Accessible text describes order/relative strength (for example, “Best match” or “Relative match strength”), not the hidden raw score.
- Automatic state selection still uses the unchanged raw `MIN_CONFIDENCE`/`MIN_MARGIN` logic internally.

### Search picker integration

- **Search instead** is a normal secondary/ghost action in the shared action row for all decision states; it no longer floats in a separate row with state-specific placement.
- Opening it renders the existing bounded picker within the result-content region above the shared divider/action row.
- The original decision content and actions remain logically intact. Closing the picker returns to the same decision and draft.
- Do not change `rankNoteMetadata()`, result limits, keyboard navigation, manual-selection confirmation, or the shared append handler.

## Chosen approach

Make two small structural extractions and keep the existing state machine:

1. Add a view-scoped, event-delegated `AnchoredTooltipController` that owns one tooltip layer for the Quick Capture root. Targets opt in with a `data-qc-tooltip` string; the controller handles hover/focus, positioning, flipping, clamping, arrow direction, accessibility linkage, and teardown.
2. Add shared DOM helpers inside `QuickCaptureView` for the decision-card shell, result row, and action row. The existing `renderMatchCard`, `renderAmbiguousCard`, and `renderCreateCard` continue to decide state-specific content/actions, but all render through the same shell.

Do not introduce a UI framework or redesign the routing state model. A controller is warranted for tooltips because native browser tooltips cannot be reliably positioned and form controls cannot safely host a CSS-only pseudo-element. Event delegation avoids accumulating listeners as the footer rerenders.

Keep candidate-row click semantics unchanged in this pass. The proposed **Use “top title”** button calls the same `handleAdd(top.path, top.title, true, controls)` path as clicking the top row. Changing all candidate rows into a separate selection/confirmation model would be a larger interaction redesign not requested by the feedback.

## Why this approach

- It resolves the tooltip defect at the component level instead of applying per-control offsets that will drift again.
- A single decision shell enforces shared spacing, divider, action order, and picker placement while preserving proven state transitions.
- Relative bars communicate ranking without presenting cosine/hybrid scores as probabilities.
- The action hierarchy preserves existing Add-and-stay and direct candidate behavior while making the top path and escape action predictable.
- It keeps the patch local to UI construction/styles and avoids touching search, indexing, cache, or write correctness.

## Repository context

Current integration points:

- `QuickCaptureView.renderQuickCapture()` creates and focuses the textarea.
- `renderFooter()` maps state to confident, ambiguous, or create cards.
- `renderMatchCard()`, `renderAmbiguousCard()`, and `renderCreateCard()` currently duplicate shell/action markup and expose raw percentages.
- `renderNotePickerSection()` currently owns both the floating trigger and picker body; split the trigger from the body so the trigger can live in the shared action row.
- `handleAdd()`, `handleCreate()`, `resetDecision()`, and `resetNotePicker()` already contain the corrected behavior and remain the only write/reset paths.
- `NotePicker.ts` is already deterministic, bounded, local metadata search and is not part of this design change.

## Files likely affected

- `src/view/QuickCaptureView.ts`
- `styles.css`
- new `src/view/AnchoredTooltip.ts` (or an equivalently named small view utility)

`src/search/NotePicker.ts` should not require a behavioral edit. If a type-only import/helper move is necessary, keep it mechanical and explain it in the Completion Report.

## Architecture

```text
QuickCaptureView
  ├─ textarea (new placeholder/focus/caret/spellcheck)
  ├─ decision state (unchanged confidence/margin routing)
  │    └─ shared decision shell
  │         ├─ state-specific content
  │         ├─ optional existing metadata picker body
  │         ├─ shared divider
  │         └─ ordered action groups + far-right Keep editing
  └─ tooltip attributes on eligible targets

AnchoredTooltipController (one per open view)
  ├─ delegated pointer/focus listeners on contentEl
  ├─ one non-interactive role=tooltip element
  ├─ target-relative fixed positioning + viewport clamp/flip
  └─ resize/scroll reposition + teardown
```

The tooltip controller is presentation-only. It does not own decision state or call plugin services.

## Interfaces

Names may vary, but keep these boundaries:

```ts
interface TooltipController {
  attach(root: HTMLElement): void;
  destroy(): void;
}

function setQuickCaptureTooltip(target: HTMLElement, text: string): void;

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

function relativeMatchStrength(score: number, topScore: number): number;
```

The exact shared-shell API can remain private to `QuickCaptureView`; do not export abstractions with only one consumer.

## Data structures

No persisted data or cache changes.

At most add:

- `tooltipController: AnchoredTooltipController | null`
- a transient tooltip target reference inside the controller
- optionally a small `DecisionShellParts` return object

Do not add new routing phases or candidate-selection state. Continue using `sorted`, `forceCreate`, `lastResults`, and existing picker state.

## Dependencies

No new dependency, icon library, UI framework, model call, cache schema, setting, or network request.

Use DOM APIs already available in Obsidian/Electron. The tooltip arrow may be a small CSS pseudo-element belonging to the tooltip component; no external asset is needed.

## Implementation steps

Follow the design document's sprint priority:

1. **Anchored tooltip component (#3).**
   - Create one tooltip layer/controller for the view root.
   - Use delegated `pointerover`/`pointerout` and `focusin`/`focusout` handling for `[data-qc-tooltip]` targets so footer rerenders do not leak listeners.
   - Position above the target, measure after render, flip below if needed, clamp horizontally inside the Quick Capture root/viewport, and update arrow alignment.
   - Reposition on relevant scroll/resize while open. Hide on Escape and teardown.
   - Preserve accessible names; link the visible tooltip with `aria-describedby` while open.
   - Replace relevant native `title` attributes in `QuickCaptureView` with the custom data attribute, including the reported textarea/title-input descriptions, truncated note/path targets, and search-close control.
2. **Unified decision panels (#5/#6/#7).**
   - Extract a shared decision shell with content, optional picker region, divider, and start/end action groups.
   - Extract a shared match-row renderer and relative bar-width helper.
   - Convert confident and ambiguous result rendering to the shared row. Remove raw `%` text. Accent only the first result and label it “best match.”
   - Refactor the three action sets into the specified order. Add **Create new note** to confident; add **Use “top title”** to ambiguous; move **Search instead** into the action row; pin **Keep editing** to the end.
   - Rename only the create card's **Back** to **Keep editing**. Preserve the manual picker's internal **Back** semantics.
   - Render the existing picker body in the shared content region when open. Do not duplicate picker state or ranking.
   - Preserve busy-state disabling: every visible action and selectable row capable of changing state during Add/Create must be disabled together.
3. **Placeholder/caret/focus (#2).**
   - Change placeholder copy to “Summarize this document”.
   - Retain the existing programmatic focus behavior.
   - Add accent caret color, a subtle focus-visible boundary treatment, and higher placeholder contrast.
4. **Spellcheck (#4).**
   - Set `spellcheck="false"` on the capture textarea.
5. Run TypeScript, the production bundle, and `git diff --check`. Trace every existing state transition and picker path after the DOM refactor.
6. Produce the manual Obsidian script below and report which parts were actually run by a human. Do not claim visual verification from static checks.

## Edge cases

### Tooltip

- Trigger near the top, bottom, left, and right of the view.
- Tooltip text for a long Unicode path; wrap to a bounded width without leaving the viewport.
- Pointer hover followed by keyboard focus and vice versa; no duplicate/stuck tooltip.
- Target removed during footer rerender while tooltip is visible.
- Scroll inside the main body or picker results; tooltip follows or closes cleanly.
- View resized, moved between panes, closed, or plugin unloaded.
- Disabled control, icon-only control, textarea, input, truncated button, and non-button title target.
- Native browser tooltip must not appear after the custom tooltip.

### Unified panels

- Confident result, ambiguous 2-result and 3-result cases, low-confidence create, empty index, indexing-in-progress, and force-create from confident/ambiguous.
- Long and duplicate note titles; button labels and rows must ellipsize/wrap without pushing **Keep editing** off-screen.
- Very narrow main-area leaf: start actions may wrap, but **Keep editing** remains the final, right-aligned escape action on its row.
- Picker open/closed/searching/manual-selection-confirm states inside every decision variant.
- Picker close returns to the same decision; **Keep editing** dismisses the decision and preserves draft.
- **Create new note** seeds a fresh title and preserves the current draft.
- All busy/error paths restore the new action controls and preserve the draft.
- A top score of zero/non-finite value is handled defensively; the bar helper returns a bounded width and never writes `NaN%`/`Infinity%` CSS.
- The confidence/margin routing thresholds and raw result order are unchanged.

### Capture field

- Empty, whitespace-only, multiline, Unicode, and shorthand text.
- Focus on initial open and return from a session note.
- Disabled state during Sort/Add/Create remains visually distinguishable from the normal focused state.
- No red squiggles after browser spellcheck is disabled.

## Failure handling

- Tooltip positioning must fail closed: if the target disconnects or measurements are invalid, hide the tooltip rather than placing it at `(0,0)` or the viewport edge.
- Tooltip teardown removes window/root listeners and the tooltip element. A rerender must not create another controller.
- If a decision action fails, retain the existing Notice/error behavior, restore all shared action controls, preserve the exact draft, and leave the user in the same decision state.
- If an excerpt fails to load, preserve the existing graceful removal; it must not affect result/action layout.
- If the note picker returns no results, its current empty state remains inside the shared panel and all other decision actions stay available.
- Non-finite/invalid scores produce a minimal muted bar, never raw text or broken CSS.

## Security and privacy considerations

- All changes are presentation-only and local.
- Tooltip text, note titles, and paths must be assigned through text APIs, never interpolated as HTML.
- Display only vault-relative paths already present in `NoteEntry`; never expose absolute filesystem paths.
- Do not add telemetry, external assets, network calls, clipboard behavior, or note-body reads.
- Do not change the append-text invariant, confirmation requirements, or write services.
- Tooltips must not contain interactive HTML or accept untrusted markup.

## Performance constraints

- Maintain one tooltip element/controller per open Quick Capture view, not one global element or one observer per target.
- Do not poll layout. Measure/reposition only when opening, while the visible target is affected by scroll/resize, or when its content changes.
- Do not add full-view rerenders for hover/focus or confidence-bar updates.
- The panel refactor must not cause an additional embedding/search pass.
- Note picker remains capped at 20 rendered metadata matches and does not render the vault up front.
- No material change to Sort, input, or picker responsiveness on a base Apple Silicon MacBook Air.

## Acceptance criteria

1. The Quick Capture textarea placeholder is exactly “Summarize this document”, has visibly increased contrast, shows an accent caret/subtle focus boundary when focused, and sets `spellcheck="false"`.
2. One reusable custom tooltip implementation is used across the Quick Capture view; migrated targets have no native `title` attribute.
3. Tooltips appear adjacent to their trigger with a pointer, flip/clamp within the view, work on hover and keyboard focus, and never remain detached after rerender/navigation/close.
4. The textarea and new-note title field keep accessible names and show the reported descriptions in correctly anchored tooltips.
5. Confident, ambiguous, low-confidence create, empty-index create, and force-create states share the same card chrome, content spacing, divider, picker placement, and action-row structure.
6. No raw hybrid-search percentage is visible in a decision card.
7. Confident and ambiguous note rows show relative bars; the top row is visually accented and is the only row labeled “best match.”
8. Relative bar widths are finite, bounded 10–100%, preserve result ordering, and are described as relative strength rather than calibrated probability.
9. Automatic phase selection still uses unchanged `MIN_CONFIDENCE` and `MIN_MARGIN` comparisons.
10. Confident action order is Add and jump, Add and stay here, Create new note, Search instead, Keep editing.
11. Ambiguous action order is Use top match, Create new note, Search instead, Keep editing; candidate rows retain their existing direct add-and-jump behavior.
12. Create/no-match action order is Create and jump, Search instead, Keep editing; the old create-card **Back** label is absent.
13. **Keep editing** is always the final, far-right action and preserves the draft while dismissing the routing decision.
14. The manual picker's internal **Back** still returns to search results without closing the overall decision.
15. **Search instead** appears in the shared action row in all three decision variants and opens the existing bounded metadata picker inside the shared panel without changing its ranking, keyboard, close, or confirm behavior.
16. **Create new note** from confident/ambiguous enters the existing editable-title create flow and performs no write before explicit confirmation.
17. Existing Add/Create busy guards, retry behavior, session sidebar updates, destination highlighting, exact-text filing, and draft reset/preservation behavior remain unchanged.
18. At narrow supported widths, controls may wrap but stay legible, ordered, operable, and inside the card; **Keep editing** remains visually separated at the end.
19. TypeScript, production esbuild, and `git diff --check` pass.
20. The Completion Report separates code/static checks from manual Obsidian GUI evidence and does not claim the latter if it was not performed.

## Test plan

### Static/code trace

- Grep the Quick Capture source for `title:`/`title=` and confirm every intended native tooltip was migrated or deliberately retained with justification.
- Trace one tooltip controller from `onOpen` through hover/focus, scroll/resize, target removal, Escape, and `onClose`; confirm no listener/controller multiplication across footer rerenders.
- Trace confident, ambiguous, low-confidence, empty-index, and force-create rendering through the same shell/action helpers.
- Confirm raw scores are used only for automatic routing, sorting, and relative width calculation—not rendered as text.
- Trace every new action to the existing `handleAdd`, `handleCreate`, `resetDecision`, `resetNotePicker`, and force-create transitions.
- Confirm opening/closing the picker cannot clear the draft or automatic decision.
- Confirm all operation-related controls are included in busy disabling after the action-row refactor.
- Run:

```sh
npx tsc --noEmit -p .
node esbuild.config.mjs production
git diff --check
```

### Manual Obsidian verification (required; approximately 10 minutes)

1. Reload the plugin in the real dev vault and open Quick Capture in a main-area leaf.
2. With an empty draft, confirm “Summarize this document” is legible, the field is focused with a visible caret/focus state, and typed shorthand/misspellings do not show red squiggles.
3. Hover and keyboard-focus the capture field, title field, truncated candidate/sidebar note, picker result, and picker close control. Confirm each tooltip is anchored with a pointer, flips near edges, and no native duplicate appears.
4. While a tooltip is visible, scroll, resize the leaf, open/close the picker, switch sidebar notes, and dismiss the decision. Confirm the tooltip repositions or disappears cleanly.
5. Produce a confident result. Confirm the top note is accented and marked “best match”, no raw percentage appears, the excerpt remains, and the actions appear in the specified order with **Keep editing** at the far right.
6. Use **Create new note** from the confident state, then **Keep editing**. Confirm the proposed title is editable and the draft is preserved.
7. Produce an ambiguous result. Confirm up to three relative bars, top-row emphasis, the primary **Use “top title”** action, direct selection of another candidate, consistent divider/action placement, and no raw percentages.
8. Open **Search instead** from confident, ambiguous, and create states. Confirm it occupies the same panel region and its existing typing, arrows, Enter, Escape, close, result confirmation, Add-and-jump/Add-and-stay, and internal **Back** behaviors still work.
9. Produce low-confidence, empty-index, and indexing-in-progress create states where practical. Confirm their copy remains truthful, card/action layout is shared, and the create-card action reads **Keep editing**, not **Back**.
10. Resize the main leaf narrow enough to wrap actions. Confirm nothing overlaps or leaves the card and **Keep editing** remains the final visually separated action.
11. Exercise Add-and-jump, Add-and-stay, ambiguous direct pick, manual pick, Create-and-jump, and failure/retry if practical. Inspect destination files to confirm the exact draft remains verbatim.

## Explicitly out of scope

- **Design issue #1: the Inbox/Notes/Graph/Dashboard/Calendar/Files/Terminal/Tools icon rail and proposed Search/Tags/Archive/Settings groups.** Those labels/icons do not exist in this plugin's source or stylesheet; they describe Obsidian's native/application chrome or another product surface. A normal plugin should not recreate Obsidian's shell inside Quick Capture. Doing so would also contradict the deliberately small, session-only sidebar and CLAUDE.md's “simple, not a Notion clone” direction.
- Adding Search, Tags, Archive, Settings, Graph, Dashboard, Calendar, Files, Terminal, or Tools destinations to the plugin's session-note sidebar.
- Replacing the session-note sidebar with a full-vault browser.
- Changing `HybridSearch`, `MIN_CONFIDENCE`, `MIN_MARGIN`, embeddings, cache/indexing, NotePicker ranking, or result count.
- Changing append/create services, verbatim text behavior, async race guards, session state, destination rendering, or highlight semantics.
- Reintroducing `@tag` targeting.
- Adding a UI framework, tooltip library, chart library, icon library, or external visual asset.
- Redesigning Obsidian's native tooltips globally; the custom tooltip is scoped to `.ai-quickcap-view`.
- Animations beyond the existing 150ms color/background transitions.
- Automated GUI infrastructure for Obsidian.

## Questions requiring human approval

None block implementation.

The brief deliberately preserves direct candidate-row filing and **Add and stay here** while applying the new action hierarchy. Removing either capability would be a product behavior change beyond the supplied visual-coherence feedback and requires separate approval.
