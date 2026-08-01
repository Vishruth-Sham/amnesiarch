# Implementation Brief Addendum

## Status and dependency

This addendum revises only the destination-input UI and its integration contract from `quick-capture-folder-destination.md`. It is intended for dispatch after the current folder-destination implementation is available for rework.

The completed parser/resolver/create-service backend remains the baseline. Do not start a second implementation while Claude is rate-limited or while another task owns the same files.

Two technical-review corrections are prerequisites regardless of this redesign:

1. `createNoteAtDestination()` must distinguish paths the accepted plan expected to exist from paths the plan expected to create. If an expected-existing folder disappears before confirmation, abort instead of recreating it.
2. Collision **Cancel** actions must not clear the destination and silently change the plan to vault-root creation.

## Objective

Replace the separate **New note title** input plus freeform **Describe destination** textarea with one progressive, root-first **Create at** composer.

The composer should:

- accept folder hierarchy and note title through the same typing surface;
- suggest exact/fuzzy existing folders progressively from live sibling metadata;
- canonicalize a folder and insert `/` when the user explicitly accepts it;
- let `/` commit the requested spelling as a new folder when no normalized exact sibling exists;
- handle ambiguity through continued typing rather than a folder-choice list; and
- preserve the final visible path and explicit create confirmation.

The captured Quick Capture text remains the exact note body. Composer text is routing/title metadata only and must never enter the Markdown body.

## Key design decision

Use progressive autocomplete with **explicit segment commitment**, not unconditional date-mask-style mutation.

A date formatter can insert separators at fixed character counts. Folder names have variable lengths. If a vault contains `AI` and the user is typing a new folder named `AI Research`, automatically committing at `AI` would corrupt the input.

Therefore:

- matching runs progressively per keystroke;
- the UI may show inline completion/correction immediately;
- no match changes the folder path merely because it is temporarily unique; and
- `/`, Tab, Enter, Right Arrow at end, or a pointer-accessible acceptance control commits a segment.

Once a segment is committed, the composer formats it as a folder token and inserts the `/` separator automatically.

## User-facing behavior

### One composer for folders and title

Replace:

```text
New note title
[ Model Evaluation ]

Describe destination
[ New folder Experiments under AI inside Learning ]
```

with:

```text
Create at
[ Learning ] / [ AI ] / [ Experiments ] / Model Evaluation
```

Committed tokens are folders. The final uncommitted text is the note title.

Examples:

- `Learning/AI/Experiments/Model Evaluation` creates `Learning/AI/Experiments/Model Evaluation.md`.
- `Learning/AI/Experiments/` uses `proposeTitle(draftText)` inside that folder.
- `Model Evaluation` creates `Model Evaluation.md` at vault root.
- an empty composer creates the proposed title at vault root, preserving existing root-create behavior.

If the typed title ends in one `.md`, remove that terminal extension before passing the title to the filename service.

### Unique existing-folder completion

Given root folder `Learning`, typing `Lea` shows an inline completion for `Learning`.

- Tab, Enter, or Right Arrow at the end accepts it.
- A pointer-accessible **Use Learning** affordance performs the same action.
- The composer becomes `Learning/` and the next segment is matched only against children of `Learning`.

Acceptance uses the folder's canonical vault spelling.

### Unique fuzzy correction

Typing `Lerning` may show:

> Suggested folder: Learning — Tab to use

The available outcomes are:

- accept `Learning`, which commits the canonical existing folder and inserts `/`;
- continue typing; or
- type `/` or activate **Create “Lerning”**, which commits the requested spelling as a new folder.

There is no post-entry correction panel.

### Ambiguous segment

If `client` is ambiguous beneath `Work`, show noninteractive inline guidance such as:

> More than one folder matches “client” under Work. Keep typing to narrow it, or press `/` to create “client”.

Do not show:

- **Choose another folder**;
- a sibling-choice list; or
- individual ambiguous-candidate buttons.

The user resolves ambiguity by typing until the result is uniquely exact/fuzzy, or explicitly commits the typed spelling as a new folder.

The resolver may retain its bounded choices internally for diagnostics/tests. The composer does not render them.

### Explicit new folder

Typing `/` commits the active folder spelling:

- if one normalized exact direct sibling exists, use its canonical existing path;
- otherwise create the requested spelling verbatim;
- never fuzzy-correct a slash-committed new folder.

This generalizes the existing “requested new-folder leaf is never fuzzy-corrected” rule to any explicitly committed new folder segment.

### Title behavior

The last uncommitted text is always treated as the note title unless the user explicitly commits it as another folder.

This deliberately allows a note title that resembles an existing folder. A suggestion is not routing until accepted.

When active title text is empty, show `proposeTitle(draftText)` as the inferred title in the final path preview. The user can type to replace it directly in the same composer.

Remove the separate **New note title** field and its `titleDirty` precedence machinery.

### Compact plan preview

Keep:

- existing/new status on committed folder tokens;
- a visible final vault-relative path;
- inferred-versus-typed note-title labeling;
- note collision handling; and
- the statement that captured text becomes note content.

Remove the separate tree-shaped correction-review workflow. Correction and ambiguity happen inline while the active token is being typed.

The primary **Create and jump** button remains the explicit filesystem confirmation.

## Input component architecture

Use a composite control containing:

- committed folder-token elements;
- visible `/` separators; and
- one native `<input>` for the active folder-or-title text.

Do not use `contenteditable`. A native input gives safer selection, clipboard, keyboard, screen-reader, and IME behavior.

Users must be able to:

- click a committed token to edit it;
- press Backspace on an empty active input to reopen the preceding token;
- paste slash-separated paths;
- clear the whole composer; and
- distinguish existing and new tokens without relying only on color.

Extract this into a focused `ProgressiveDestinationComposer` controller/component rather than adding more rendering and keyboard logic directly to `QuickCaptureView`.

`QuickCaptureView` should continue to own:

- the Quick Capture draft;
- create-card entry/dismissal;
- busy state;
- final plan confirmation;
- successful filing/sidebar/highlight/navigation behavior; and
- draft-tied state lifecycle.

## Keyboard behavior

- **Tab:** accept a unique suggestion and insert `/`; if there is no suggestion, permit normal focus traversal.
- **Enter:** accept a visible unique suggestion. Enter inside the composer must not create the note.
- **Right Arrow at end:** accept an inline suggestion; otherwise retain native caret behavior.
- **/**: commit the active text using the normalized-exact-existing-or-verbatim-new rule.
- **Backspace with an empty active input:** reopen the previous committed token for editing.
- **Escape:** dismiss the active suggestion/message without clearing committed tokens.
- **Create and jump:** remains the ordinary create command.

Pointer users get equivalent acceptance affordances for the one unique suggestion and explicit typed-folder creation. There is no pointer sibling browser for ambiguous matches.

## IME and text-input requirements

- Track `compositionstart` and `compositionend`.
- Do not resolve, autocomplete, prevent `/`, or handle Enter/Tab while `event.isComposing` is true.
- Tolerate key code `229` as composition input.
- Recompute once on `compositionend`.
- Never replace the active native input while it owns focus.
- Do not tokenize partially composed text.

The existing implementation's lack of an IME guard was mostly visual. It becomes a correctness requirement once typing can commit or rewrite segments.

## Paste behavior

For a slash-separated paste:

1. treat all completed segments before the final segment as folders;
2. treat the final segment as note title unless the paste ends with `/`;
3. resolve folder segments sibling-by-sibling;
4. stop visibly at the first fuzzy/ambiguous/collision state requiring input; and
5. never accept a fuzzy correction solely because it arrived via paste.

Do not retain a second leaf-first freeform-sentence mode in this pass. A phrase such as `Experiments under AI inside Learning` cannot be sibling-resolved progressively until the sentence is substantially complete. The revised primary syntax is root-first because it is what makes safe progressive resolution possible.

Keep `parseDestinationInstruction()` and its tests for now so completed backend work is not discarded, but it no longer drives the primary composer.

## Resolver integration

### Unchanged backend

Retain:

- `normalizeForComparison()`;
- Levenshtein implementation;
- `BALANCED_FUZZY_POLICY` and its synthetic-evidence caveat;
- sibling-only resolution;
- `FolderSnapshot` and `buildFolderSnapshot()`;
- path/segment safety validation;
- excluded-folder policy;
- final `DestinationPlan` validation;
- targeted note collision policy;
- partial folder-creation reporting; and
- exact-content write behavior.

### Additive segment-suggestion API

Expose the current direct-sibling resolution logic through a pure helper:

```ts
function suggestFolderSegment(
	requested: string,
	parentPath: string,
	snapshot: FolderSnapshot,
	policy?: FuzzyPolicy,
): FolderSegmentSuggestion;
```

Suggested result:

```ts
type FolderSegmentSuggestion =
	| { kind: "empty" }
	| { kind: "exact"; folder: FolderInfo }
	| { kind: "fuzzy"; requested: string; folder: FolderInfo }
	| { kind: "ambiguous"; requested: string }
	| { kind: "none"; requested: string };
```

The UI does not need ambiguity choices. Existing internal choice data can remain for the old parser/tests.

### Final-plan adapter

The composer constructs a `DestinationParse`-equivalent input from:

- committed existing folder tokens as `resolve-or-create` segments using canonical names;
- committed new folder tokens as `create-new` segments;
- active non-empty text as `explicitTitle`; or
- `proposeTitle(draftText)` as fallback when active text is empty.

Then call the existing whole-plan resolver before creation. Do not bypass final validation merely because tokens were resolved incrementally.

`create-new` must be supported intentionally at any segment position. The current resolver already branches on segment intent at every index; rename leaf-specific helpers/comments and add tests so this is a documented contract.

## Create-service prerequisite correction

The progressive UI does not otherwise require a new create-service shape, but the technical review found a stale-plan defect.

Stop treating `missingFolders` as informational:

1. Validate that every entry is a normalized prefix of `folderPath`.
2. Preflight every folder prefix before mutation.
3. Prefixes absent from `missingFolders` were expected to exist and must still be `TFolder`s.
4. Prefixes in `missingFolders` may be absent or may now be exact `TFolder`s created concurrently.
5. Any conflicting `TFile`, missing expected-existing folder, or changed path aborts before mutation.
6. Preflight the target note collision before creating folders.
7. Only after the entire plan passes should missing folders be created parent-to-child.

This preserves the current request interface while making the accepted plan semantically enforceable.

## View-local state

Replace the current freeform/title state with approximately:

```ts
interface ComposerFolderToken {
	requested: string;
	name: string;
	path: string;
	disposition: "existing" | "create";
	correctedFrom?: string;
}

composerFolders: ComposerFolderToken[];
composerActiveText: string;
composerSuggestion: FolderSegmentSuggestion;
composerDraftSnapshot: string | null;
composerIsComposing: boolean;
```

Remove:

- `destinationChoices` from the primary UI path;
- `destinationExpandedChoice`;
- `titleValue`/`titleDirty`/separate title-source state;
- separate title/destination element references; and
- the sibling-picker state.

Preserve lifecycle rules:

- **Keep editing** preserves composer state for the unchanged draft;
- any draft edit clears composer state;
- picker open/close preserves it;
- validation/create failure preserves it;
- successful append/create clears it; and
- view close clears it.

## Performance

Do not rebuild `getAllFolders()` plus the full parent map on every character.

- Build a folder snapshot when the create card opens or the composer receives focus.
- Per keystroke, inspect only `childrenByParent.get(currentParentPath)`.
- Refresh the snapshot on folder-token commitment and before final creation.
- If the fresh final validation changes a token's resolution, return to the composer rather than mutate.
- Profile a large synthetic or real folder tree before adding debounce.

No embeddings, hybrid search, note-body reads, model calls, network calls, or full-vault DOM lists.

## Collision behavior

Remove collision **Cancel** actions that clear the destination.

- Folder exact collision: accept the existing folder or reopen/edit the token.
- Note collision: offer **Open existing note** and focus/edit the final title text.
- Neither action may silently switch the plan to vault root.
- Targeted collisions never overwrite, append, or numeric-suffix.

## Exact UI removals

Remove:

- **Choose another folder**;
- `renderDestinationSiblingPicker()`;
- `destinationExpandedChoice`;
- sibling-picker CSS;
- separate **New note title** input;
- freeform destination textarea;
- post-entry fuzzy/ambiguity panels; and
- collision **Cancel** controls that clear the destination.

Retain as inline equivalents:

- use the unique suggested folder;
- create the typed folder;
- continued typing to resolve ambiguity;
- open an existing colliding note;
- edit the active title/token;
- final path preview;
- **Search instead**; and
- **Keep editing**.

## Implementation steps

1. Apply the create-service stale-plan correction and add regression coverage.
2. Expose the pure per-segment suggestion helper without changing thresholds or sibling-only policy.
3. Document/test `create-new` at any segment position.
4. Extract the composer component/controller from `QuickCaptureView`.
5. Replace the title input and destination textarea with committed tokens plus one native active input.
6. Implement explicit suggestion acceptance, slash commitment, Backspace token reopening, pointer equivalents, and final-title semantics.
7. Add IME composition guards before implementing any autoformatting.
8. Adapt committed tokens into the existing whole-plan resolver for final validation.
9. Replace collision recovery with token/title editing; remove destination-clearing Cancel behavior.
10. Cache the folder snapshot and refresh it only at meaningful boundaries.
11. Remove obsolete sibling-picker/correction-panel state and CSS.
12. Preserve the existing busy, exact-content, sidebar, highlight, navigation, and failure flows.
13. Run retained parser tests, new composer/resolver tests, TypeScript, production esbuild, and `git diff --check`.
14. Produce a manual Obsidian verification report without claiming GUI verification from static checks.

## Acceptance criteria

1. One **Create at** composer accepts folder hierarchy and note title.
2. The final uncommitted text is the title; trailing `/` uses `proposeTitle(draftText)`.
3. No separate title input or freeform destination textarea remains.
4. Suggestions consider only cached direct siblings of the committed parent.
5. A folder is never committed merely because it temporarily matches while typing.
6. Accepting a unique suggestion canonicalizes the folder token and inserts `/`.
7. Typing `/` preserves the spelling as new unless a normalized exact sibling exists.
8. Fuzzy correction requires explicit keyboard or pointer acceptance; it is never silently applied.
9. Ambiguity exposes no sibling list or **Choose another folder** action.
10. Ambiguity is resolved through continued typing or explicit creation of the typed spelling.
11. The separate post-entry correction/ambiguity review panels are gone.
12. IME composition never triggers tokenization, rewriting, or suggestion acceptance.
13. Slash-separated paste resolves folder segments in order and treats the last non-trailing segment as title.
14. The final path and existing/new folder states remain visible before confirmation.
15. An expected-existing folder disappearing before creation aborts rather than being recreated.
16. Collision recovery never silently changes the destination to root.
17. Composer/title/destination text never enters the Markdown body.
18. The exact Quick Capture draft reaches the create service unchanged except for the established structural final newline.
19. Existing busy guards, failures, state lifecycle, sidebar, highlight, and navigation behavior remain intact.
20. Pure tests, TypeScript, production build, and `git diff --check` pass.
21. Static evidence and real Obsidian GUI verification are reported separately.

## Test plan

### Pure tests

- exact, prefix, fuzzy, ambiguous, and no-match active-segment suggestions;
- wrong-parent folder never suggested;
- Tab/Enter/Right Arrow acceptance;
- `/` exact-existing versus verbatim-new behavior;
- explicit new folders at intermediate depths;
- folder-looking final text remains a title until committed;
- blank/trailing-slash inferred title;
- terminal `.md` handling;
- Backspace token reopening;
- slash-separated paste;
- ambiguity exposes no candidate list;
- stale expected-existing folder aborts;
- concurrently created expected-new folder is accepted only as exact `TFolder`;
- target note collision is checked before folder mutation;
- destination/composer text cannot reach the content payload.

Retain the existing balanced-policy and parser fixtures even though sentence parsing is no longer the primary UI.

### Static/code trace

- trace all draft-state reset/preserve paths;
- trace composer tokens into the final `DestinationPlan`;
- trace only `draftText` into `content`;
- trace every folder commit as exact accepted or explicit new;
- verify no ambiguous/fuzzy suggestion can reach `ready` without explicit acceptance;
- verify all composer controls disable during creation;
- verify no old sibling-picker state/CSS remains;
- run TypeScript, production esbuild, and `git diff --check`.

### Manual Obsidian verification required

- exact and fuzzy autocomplete at root and nested levels;
- ambiguous siblings with no list/buttons;
- continuing to type until ambiguity resolves;
- `/` to create a new folder near a similarly named existing folder;
- note title typed in the same composer;
- inferred title after a trailing slash;
- title that matches a folder name;
- pointer and keyboard acceptance;
- IME composition;
- path paste;
- token editing and Backspace reopening;
- narrow panes and long/Unicode names;
- large-vault typing latency;
- folder/note collisions;
- expected-existing folder removed between preview and click;
- byte-for-byte note content confirming composer text is absent.

No agent in this environment can perform this GUI verification.

## Explicitly out of scope

- A second natural-language sentence-entry mode alongside the composer.
- A **Choose another folder** or sibling-browser surface.
- Automatic segment commitment based only on temporary matcher uniqueness.
- LLM parsing, embeddings, semantic aliases, phonetic matching, or network calls.
- Full-vault folder browsing.
- Persisted composer history or learned corrections.
- Changing hybrid note search, the note picker, session sidebar scope, or match-strength UI.
- Overwriting/appending/renaming/deleting existing files or folders.

