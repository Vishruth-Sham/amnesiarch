# Implementation Brief

## Objective

Add a manual, live note-search override to every Quick Capture routing decision state so the user can choose a destination from the indexed vault rather than being limited to the AI-ranked candidates.

This is a follow-up to Quick Capture task `task_0c92f0fcb7b6`. Do not begin implementation until that task has landed, passed review, and its actual component/state structure has been reconciled with this brief.

## Context

The Quick Capture redesign intentionally removes the old `@tag` pre-targeting flow. Its replacement belongs at the routing decision step, after the unchanged hybrid search and `MIN_CONFIDENCE`/`MIN_MARGIN` decision logic have produced a confident, ambiguous, or no-match card.

The current `src/view/ChatView.ts` is reference material only. It demonstrates the existing three decision states, AI candidate selection, and append/create services, but the in-flight Quick Capture work is expected to replace or substantially restructure it. Before editing, inspect the accepted Quick Capture diff and map the concepts below onto the actual decision-card component, state, and shared filing actions. Do not preserve obsolete class names, method names, paths, chat-message concepts, `@tag` state, or the old composer merely to match this brief.

Locked surrounding architecture:

- Quick Capture opens in the main workspace area.
- Its draft is ephemeral view-local state, not a vault file.
- The sidebar is session-accumulated, not a full-vault browser.
- `search()` in `HybridSearch.ts`, `MIN_CONFIDENCE`, and `MIN_MARGIN` remain the source of truth for automatic routing.
- `appendToNote()`, `createNote()`, and `proposeTitle()` remain the source of truth for filing and creation.
- The manual override performs metadata matching only. It must not call `embedText()` or `search()` again.

## User-facing behavior

1. Every confident, ambiguous, and no-match decision card exposes a quiet secondary trigger labeled **Search notes instead**.
2. Activating it reveals a compact search input inside the existing card and focuses the input.
3. No full-vault list is rendered on open. Before the user types, show short instructional copy such as “Type a note title or path.”
4. As the user types, show at most 20 ranked matches from `plugin.cache.getAll()`, matching against both note title and path. Results update immediately without model work, indexing, network calls, or vault-content reads.
5. Each result shows its title and enough path context to distinguish duplicate titles. The path is the stable identity used for filing.
6. Selecting a result must enter the exact same explicit-destination path used by selecting an AI candidate in the landed Quick Capture implementation. It must not create a second append implementation.
   - If the accepted Quick Capture implementation makes candidate-row selection append and jump immediately, manual-result selection does the same.
   - If it first selects a destination and then exposes **Add and jump** / **Add and stay here**, manual-result selection uses that same selected-destination state and action set.
   - Reconcile this point against the accepted diff before coding; behavioral parity with an AI-candidate pick is the requirement.
7. Successful filing updates the session sidebar, active-note/highlight state, draft clearing, and navigation exactly as the equivalent AI-candidate action does.
8. **Escape** closes the search UI and returns to the unchanged decision card. It does not dismiss the decision or alter the draft. A visible close/back affordance must provide the same behavior for pointer users.
9. Editing the Quick Capture draft continues to invalidate the whole pending decision. It must also clear the manual-search query, results, focus/selection state, and open state.
10. An empty query never displays the entire vault. A non-empty query with no matches displays “No notes found” without changing the original AI decision or losing the draft.
11. While an index rebuild is incomplete, the search covers only entries currently present in the cache. If the landed view exposes indexing state, use it to say “No indexed notes found yet” or “Indexing — more notes may appear” rather than implying a definitive vault-wide miss. Do not add a second vault-file browser in this task.

The trigger should fit the quiet-utilitarian visual language of the decision card. Recommended placement:

- Confident: replace the AI-only “Choose another note” chip row with **Search notes instead**. If the accepted redesign retained useful AI alternates, the trigger may sit beside them, but do not let a potentially long alternate row compete with the manual search.
- Ambiguous: place below the AI candidate list and before or beside **+ New note instead** / **Keep editing**.
- No-match: place with **Use closest** / **Create new note**, visually secondary to the primary recovery action.

## Chosen approach

Create one reusable decision-card-local note picker and one small pure metadata-ranking helper.

The picker receives the cached note entries and an `onSelect(path)` callback (or the accepted implementation's equivalent destination-selection callback). It owns only transient picker UI state: open/closed, query, highlighted result index, and current limited results. The parent decision flow continues to own the draft, selected destination, append/create operations, sidebar/session history, and navigation.

Use a deterministic, dependency-free matcher over normalized `title` and `path` strings. Rank obvious matches ahead of fuzzy ones:

1. exact normalized title
2. title starts with query
3. title contains query
4. path contains query
5. ordered-subsequence fuzzy match across title, then path, with a penalty for gaps and longer candidate text

For multi-word input, normalize whitespace and score the full query plus its tokens; require every non-empty token to have at least a substring or credible ordered-subsequence match. This keeps typo tolerance without returning arbitrary notes for very weak matches. Break equal scores deterministically by normalized title, then normalized path.

Normalize with `trim()`, repeated-whitespace collapse, Unicode-aware lowercasing, and diacritic folding where supported. Do not mutate or normalize the displayed title/path.

Scan the current cached metadata on input and retain only the best 20 results. A full sort of all entries is acceptable for normal vault sizes, but do not create DOM nodes for the full cache. If the accepted Quick Capture implementation can receive cache changes while the picker is open, recompute from a fresh `cache.getAll()` snapshot on each query; otherwise read once when opening and document that reopening refreshes it.

## Why this approach

- It restores explicit user control at the moment the automatic decision is visible, rather than reintroducing pre-search syntax.
- It is local, deterministic, cheap, and instant; embeddings and vault-content reads provide no value for an explicit title/path lookup.
- A reusable picker prevents the three decision variants from drifting in behavior.
- Reusing the existing candidate-selection/filing callback preserves append semantics, navigation, highlight behavior, busy/error handling, and session-sidebar updates.
- A bounded result list satisfies the large-vault constraint without turning the session sidebar into a vault browser.
- A small pure matcher is easy to inspect and test and adds no runtime dependency.

## Repository context

Relevant current references, subject to the required post-Quick-Capture reconciliation:

- `design_handoff_ai_quick_capture/README.md`: target Quick Capture layout, decision states, and session-sidebar behavior.
- Current `src/view/ChatView.ts`: reference for confident/ambiguous/no-match routing and explicit candidate selection only; expected to be replaced.
- `src/index/NoteCache.ts`: `getAll()` returns indexed `NoteEntry[]`.
- `src/types.ts`: `NoteEntry.path` and `NoteEntry.title` are sufficient for this picker.
- `src/search/HybridSearch.ts` and `src/constants.ts`: automatic routing remains unchanged.
- `src/append/AppendService.ts` and `src/create/CreateNoteService.ts`: write/create services remain unchanged.
- `styles.css`: quiet-utilitarian UI conventions and, after the dependency lands, the Quick Capture decision-card styles.
- `CLAUDE.md`: local-only, append-text, scale, and manual-verification constraints.

## Files likely affected

Exact paths must be revised after reviewing the accepted Quick Capture diff. Likely surfaces are:

- the new Quick Capture view/controller file containing decision state
- the decision-card renderer/component, if separated from the view
- a new small metadata matcher/picker helper under an appropriate `src/search/` or `src/view/` module
- `styles.css`
- any existing test fixture or lightweight test location introduced by the Quick Capture task

Do not edit the old `ChatView` path if it no longer owns the live decision card. Do not change `HybridSearch.ts`, embedding code, cache schema, append/create services, or indexing unless the reconciliation pass reveals a concrete integration defect.

## Architecture

```text
automatic sort
  -> unchanged embedText + HybridSearch + confidence/margin decision
  -> confident | ambiguous | no-match decision card
       -> Search notes instead
       -> metadata picker(cache.getAll snapshot, query)
       -> bounded ranked title/path results
       -> existing explicit-candidate selection callback(path)
       -> existing append/action/navigation/sidebar/highlight flow
```

Keep the manual picker orthogonal to automatic routing. It neither changes AI scores nor manufactures a `SearchResult` score. A manually chosen entry is an explicit user decision, so it bypasses `MIN_CONFIDENCE`/`MIN_MARGIN` exactly as an explicitly chosen ambiguous candidate does.

There must be one parent-level destination-selection path. Both AI candidate rows and manual-search results call it. That path is responsible for resolving the selected cache entry/path into the accepted Quick Capture filing state and for guarding against a note that was deleted or renamed after the picker rendered.

## Interfaces

Adapt names to the accepted architecture. The useful conceptual boundary is:

```ts
interface NotePickerItem {
  path: string;
  title: string;
}

interface RankedNotePickerItem extends NotePickerItem {
  score: number; // picker-local ranking only; never shown as AI confidence
}

interface NotePickerOptions {
  getEntries: () => NoteEntry[];
  onSelect: (path: string) => void | Promise<void>;
  onClose: () => void;
  limit?: number; // default 20
}

function rankNoteMetadata(
  query: string,
  entries: readonly NoteEntry[],
  limit?: number,
): RankedNotePickerItem[];
```

Do not label the picker-local score as a match percentage. It is only an ordering mechanism and is not comparable to hybrid-search confidence.

## Data structures

No persisted schema changes.

Add only ephemeral state, colocated with the decision card or its picker:

- `isNotePickerOpen: boolean`
- `notePickerQuery: string`
- `notePickerResults: NotePickerItem[]`
- `highlightedResultIndex: number` (reset/clamp whenever results change)

Use `path` as identity and `title` as display text. Do not use title as a key because duplicate note titles are valid. Do not store the manual selection in the embedding results array or fabricate a semantic score.

## Dependencies

No new package dependency, model invocation, network request, background process, cache format, or persisted setting.

Use existing Obsidian/DOM APIs and the accepted Quick Capture UI patterns. If the accepted diff already introduced a generic searchable list component that meets these requirements, reuse it instead of adding a parallel picker.

## Implementation steps

1. Wait for `task_0c92f0fcb7b6` to be accepted. Read its diff and completion/review notes. Update this brief's file map and translate the conceptual state/actions to the actual names before editing.
2. Identify the single callback/state transition used when a user explicitly picks an ambiguous AI candidate. If the three cards currently duplicate filing behavior, first extract the smallest shared explicit-destination handler necessary; do not broadly refactor the view.
3. Implement the pure metadata normalizer and ranker. Keep scoring constants local and documented. Return no results for an empty/whitespace query and cap output at 20.
4. Implement one reusable compact picker renderer/component with input, bounded result list, empty/help states, path disambiguation, close behavior, and keyboard navigation.
5. Add the same **Search notes instead** entry point to confident, ambiguous, and no-match cards. Opening it must not replace or mutate the underlying AI decision.
6. Wire manual result selection to the shared explicit-candidate handler. Do not call `appendToNote()` directly from the picker unless that is already the shared accepted candidate action; there must not be two filing flows.
7. Reuse the accepted busy/error behavior. Disable repeated selection while an immediate filing action is in progress. If the chosen path no longer resolves, keep the draft intact, show the existing local error treatment/Notice, and refresh or close the stale result.
8. Reset picker state when the draft changes, the decision is dismissed, sorting is rerun, filing succeeds, the active decision is replaced, or the view closes. Merely closing the picker must not clear the draft or decision.
9. Add styles consistent with the new decision card: compact input, bounded scroll area, quiet result rows, visible keyboard highlight/focus ring, ellipsized title/path, and no full-pane/full-vault browser treatment.
10. Build and run the available static checks. Then prepare the manual Obsidian verification script below; do not claim GUI verification from a successful build.

## Edge cases

- Empty/whitespace query: instruction only, zero note rows.
- One-character query: still bounded to 20; no unbounded DOM list. If performance is poor in a real large vault, require two characters rather than adding debounce/complexity prematurely.
- Duplicate titles: show distinct parent/path context; select by full path.
- Mixed case, repeated spaces, diacritics, Unicode titles/paths, punctuation, and folder separators.
- Typo/abbreviation that can be handled by ordered-subsequence matching.
- Query matching a folder/path but not the basename.
- Current AI candidate also appears in manual results: selecting it is valid and uses the same action path.
- Empty cache/no notes indexed: explain the indexed-cache state and preserve create/keep-editing actions.
- Progressive indexing: results may be incomplete until indexing finishes; never claim a definitive vault-wide absence while the index is visibly incomplete.
- Cache changes while picker is open: deleted/renamed note must fail safely at selection; newly indexed entries appear on recomputation or after reopen, according to the reconciled state model.
- Very long paths/titles: truncate visually without truncating the selected path value; expose the full path via title text or accessible label.
- Fast typing and repeated open/close: no stale highlighted index, duplicate listeners, or selection of a result from the previous query.
- Enter with no highlighted result/no results: no action.
- Escape: closes picker only; draft and decision remain.
- Draft edit while picker has focus/open state: decision invalidation clears picker state consistently.
- Rapid double-click/Enter: at most one append/create navigation action.

## Failure handling

- Ranking is synchronous and should not throw for malformed metadata. Treat missing title defensively by deriving display text from path if necessary, but do not alter the cache schema.
- If the selected file was deleted, moved, or is no longer a `TFile`, surface the existing append failure feedback, preserve the exact draft, and allow another search/selection. Never report success or clear the draft on failure.
- If `cache.getAll()` is empty, retain all original no-match/create actions and show an indexed-cache-specific empty state.
- If an immediate add-and-jump append succeeds but navigation fails, do not retry the append automatically; report the navigation problem while reflecting that filing succeeded, to avoid duplicate text.
- All async selection actions must have an in-flight guard and restore usable controls after failure.

## Security and privacy considerations

- Entirely local: only already-indexed title/path metadata is searched.
- No Ollama, hosted API, telemetry, network, clipboard, or shell call.
- Do not read note bodies for picker matching or previews.
- Do not expose absolute filesystem paths; display vault-relative `NoteEntry.path` only.
- Preserve the append-text invariant: the exact Quick Capture draft reaching the existing filing service must be unchanged. The picker affects only destination selection.
- Render title/path through text APIs, never HTML interpolation, so note names cannot inject markup.

## Performance constraints

- No embeddings or `HybridSearch.search()` calls after the picker opens or query changes.
- No DOM rendering of all cached notes; render at most 20 result rows.
- Target visibly immediate updates for a 20,000-note cache on a base Apple Silicon MacBook Air. Treat median input-to-render under 50 ms as the goal, but do not claim it without measurement.
- Keep work O(number of indexed notes × normalized query length) with small bounded per-entry allocations where practical.
- Normalize the query once per update. Avoid rebuilding expensive searchable documents or reading vault files per keystroke.
- Start without a debounce. Add a short 50–100 ms debounce only if profiling against a large synthetic cache demonstrates input jank; if added, ensure stale query results cannot overwrite newer ones.

## Acceptance criteria

1. Confident, ambiguous, and no-match decision cards each expose **Search notes instead**.
2. Opening the picker does not change the draft, AI decision, automatic ranking, or create-note option.
3. An empty query renders no vault list; any non-empty query renders at most 20 title/path metadata matches.
4. Exact title, title prefix/substring, path substring, case-insensitive, duplicate-title, and basic typo/subsequence cases rank deterministically and select the correct full path.
5. Manual search performs no embedding, hybrid-search, vault-content-read, external, or network call.
6. Selecting a manual result follows the same explicit-destination action/state transition as selecting an AI candidate in the accepted Quick Capture implementation.
7. A successful manual filing preserves the draft text verbatim on disk and produces identical sidebar, highlight, active-note, draft-clearing, add-and-jump/add-and-stay behavior to the equivalent AI-candidate filing action.
8. A failed/stale-path filing never clears or transforms the draft and never claims success.
9. Editing the draft invalidates the decision and fully resets picker state; closing only the picker preserves the decision and draft.
10. Keyboard use supports focus on open, Arrow Up/Down through visible results, Enter to select, and Escape to close; pointer use has equivalent open/select/close actions.
11. Result rows expose title plus distinguishing vault-relative path context and use full path identity.
12. Large result sets are bounded in DOM size, long strings do not break the card, and the picker remains within the decision-card layout.
13. TypeScript and production esbuild complete successfully with no new warnings attributable to this change.
14. The Implementer reports static/code-trace evidence separately from the required manual Obsidian GUI verification; build success alone is not a product-pass claim.

## Test plan

### Pure matcher checks

Use a small fixture containing exact/prefix/substring/path-only matches, duplicate titles in different folders, Unicode/diacritics, long paths, and an unrelated note. Verify:

- whitespace-only input returns `[]`
- result count never exceeds 20
- exact title outranks prefix, substring, path-only, and fuzzy matches
- basic case/space/diacritic normalization
- a simple typo/abbreviation produces the intended fuzzy candidate without admitting unrelated weak matches
- ties resolve by title then path
- duplicate-title selections retain distinct full paths

If the landed task has no test framework, keep the matcher pure and document these cases for code trace/manual verification rather than introducing a framework solely for this feature.

### Static/behavioral trace

- Confirm all three card variants instantiate the same picker.
- Confirm picker selection calls the shared AI-candidate destination handler.
- Trace append text from the untouched draft to `appendToNote()`/`createNote()`.
- Trace success/failure, navigation-after-append, sidebar accumulation, highlight state, repeated click guarding, and every picker reset path.
- Confirm no picker event calls `embedText()`, `search()`, vault content reads, or external services.

### Manual Obsidian verification (required; 5–10 minutes)

1. Build, reload the plugin in the real dev vault, and open Quick Capture in the main workspace.
2. Produce a confident decision. Open **Search notes instead**, verify focus, type an exact title not present in the AI alternates, and select it. Confirm filing/action behavior, navigation/stay behavior, sidebar addition, and highlight match an AI-candidate selection.
3. Produce an ambiguous decision and repeat with a path/folder substring. Confirm the original candidate list and **+ New note instead** remain available after closing the picker.
4. Produce a no-match decision and repeat. Confirm **Use closest** and **Create new note** remain available after closing the picker.
5. Search for two notes with the same title in different folders; confirm the UI distinguishes them and the chosen full path receives the text.
6. Try case differences, a small typo/abbreviation, Unicode if present, and a nonsense query. Confirm ranking is useful, no-match copy is honest, and the list never expands to the whole vault.
7. Open the picker and edit the draft. Confirm the decision and picker disappear and the edited draft remains intact.
8. Reopen, then press Escape. Confirm only the picker closes. Test Arrow keys and Enter.
9. Trigger a stale-path failure if practical by renaming/deleting a displayed result before selection. Confirm no success message, no draft loss, and no write to a wrong note.
10. Inspect the filed note and confirm the captured text is verbatim, with no rewrite, truncation, or duplication.

## Explicitly out of scope

- Restoring `@tag` or any other pre-target syntax.
- Changing automatic hybrid search, embeddings, `TOP_K`, `MIN_CONFIDENCE`, `MIN_MARGIN`, or structural scoring.
- Re-embedding the manual query or searching note bodies.
- Turning the session sidebar into a full vault browser.
- Persisting Quick Capture or picker state across view/plugin restarts.
- New note creation behavior beyond retaining access to the existing flow.
- Cache schema/indexer changes, a new search index, or a third-party fuzzy-search dependency.
- Search result previews, excerpts, match percentages, recent-note weighting, aliases/tags, folder browsing, or command-palette integration.
- General refactoring of the accepted Quick Capture implementation.

## Questions requiring human approval

None before handoff, provided the accepted Quick Capture implementation has one clear candidate-selection behavior.

If the post-landing reconciliation finds that ambiguous candidate rows file-and-jump immediately while confident manual override is expected to offer **Add and jump** / **Add and stay here**, pause and ask the Manager which interaction should be canonical. Do not ship two different manual-selection meanings across decision-card variants.

## Reconciliation checklist before implementation starts

- Record the accepted Quick Capture view/component file paths and replace the provisional file map above.
- Identify the actual decision-state representation for confident, ambiguous, no-match, and create states.
- Identify the shared candidate-selection, append, navigation, stay, sidebar, highlight, success, and failure paths.
- Confirm whether candidate selection is immediate add-and-jump or destination selection followed by explicit actions.
- Confirm how indexing progress is available to the view and how the accepted UI phrases incomplete-index states.
- Confirm how view-local listeners/state are disposed on rerender and close.

The implementation may begin only after these six items are resolved against the reviewed diff.
