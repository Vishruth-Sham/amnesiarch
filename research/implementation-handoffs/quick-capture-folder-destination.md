# Implementation Brief

## Objective

Extend Quick Capture's create-note decision flow with an optional, separate **Describe destination** field. The field lets the user describe an existing folder hierarchy, folders to create, and optionally a note title in constrained natural language. While the user types, show a local, deterministic folder-tree plan; resolve minor ancestor-folder typos against the live vault one level at a time; require the user to resolve or acknowledge every correction and ambiguity; then create the required folders and note only after the exact destination is visibly confirmed.

The original Quick Capture draft remains the new note's body, verbatim. Destination text is routing metadata only and must never be written into the note.

## Context

This brief targets the current post-design-improvements `QuickCaptureView.ts`, not the earlier Quick Capture UI. The live implementation now has:

- a shared decision shell for confident, ambiguous, low-confidence, and empty-index states;
- a create card with an editable `proposeTitle(draftText)` title;
- `AnchoredTooltip` and shared action rendering;
- relative match-strength bars instead of raw confidence percentages;
- the metadata-only **Search instead** note picker;
- guarded async append/create actions and the append-text invariant;
- an existing `createNote()` service that creates only at the vault root and silently suffixes filename collisions.

Build this feature on top of that structure. The create state remains one variant of the shared decision shell; do not reintroduce a standalone, visually inconsistent create panel.

This feature answers a no-match routing gap without reintroducing `@tag`: the user supplies destination intent after seeing the decision, in a field separate from the captured note. It does not attempt to infer folder intent from the captured note's prose.

Sources of truth:

- `src/view/QuickCaptureView.ts`: current view state, shared decision shell, create flow, busy guards, input lifecycle, and session sidebar updates.
- `src/view/AnchoredTooltip.ts`: current tooltip component; reuse it for truncated paths or short explanations.
- `src/create/CreateNoteService.ts`: current title proposal, filename rules, verbatim-content invariant, and root-create behavior.
- `src/index/ExcludeMatcher.ts`: plugin-owned excluded-folder semantics.
- `research/experiment-results/folder-destination-poc/README.md`: POC design, measured synthetic results, and caveats.
- `research/experiment-results/folder-destination-poc/poc.js`: executable reference algorithm and labeled synthetic cases. It is research code, not production code to copy wholesale.
- `CLAUDE.md`: local-only behavior, simple-product direction, append-text invariant, and GUI-verification limits.

## User-facing behavior

### Create-card fields

The current create card keeps its editable **New note title** input and adds a distinct compact textarea below it:

```text
New note title
[ Model Evaluation                                      ]

Describe destination (optional)
[ New folder Experiments under AI inside Learning      ]
  Name existing parent folders and any folder to create. `/` also works.
```

Recommended placeholder:

> New folder Experiments under AI inside Learning

The destination input is separate from the Quick Capture draft. Do not combine note content and destination syntax in one field. Set `spellcheck="false"` because folder names, paths, and shorthand commonly look misspelled.

Empty destination text preserves today's behavior: the preview identifies the vault root and **Create and jump** creates the note there using the existing root collision policy. As soon as destination text is non-empty, the targeted path rules and explicit collision handling in this brief apply.

### Supported instruction shapes

The UI should teach a small, predictable grammar rather than claim to understand arbitrary prose. Support these shapes:

- `New folder abc under AI inside Learning`
- `Create Experiments under Learning/AI`
- `Learning / AI / Experiments`
- `Create note "Model Evaluation" under Learning/AI/Experiments`
- `Put this in Learning/AI and call the note "Model Evaluation"`

Treat `/` and `>` as explicit hierarchy separators. Support relational words used by the POC (`under`, `inside`, `in`, `within`, `beneath`, and chains such as `X under Y under Z`). Ignore harmless structural filler such as `folder`, `which is`, and articles only where the grammar expects them.

For title extraction, prefer quoted text after `note`, `called`, or `named`. A clearly parsed explicit title may seed the title input, but the title input remains visible and editable. If no title is explicitly supplied, retain the existing `proposeTitle(draftText)` suggestion; never use a requested new folder name as the note title.

Copy beneath the field should link to or reveal examples, not expose a formal grammar or edit-distance scores.

### Live structured preview

For every non-empty, parseable instruction, render a compact tree immediately below the field. It must distinguish existing folders, accepted/suggested corrections, and filesystem objects that will be created:

```text
Destination
Learning                         Existing
└─ AI                            Existing
   └─ abc                        New folder
      └─ Model Evaluation.md     New note · title inferred from capture

Final path: Learning/AI/abc/Model Evaluation.md
The captured text will be used as the note content.
```

If the instruction explicitly supplies a title, say `title from destination description`; otherwise say `title inferred from capture`. If the user manually edits the title input, say `title edited by you`.

The final vault-relative path must always be visible before mutation. Do not show absolute filesystem paths.

### Fuzzy correction display

Fuzzy resolution proposes an existing folder; it is never a silent rewrite. For example:

```text
“Lerning” may mean “Learning”
[Use Learning] [Choose another folder] [Keep “Lerning” and create it]
```

- **Use Learning** records an explicit transient acknowledgement and updates the preview.
- **Choose another folder** shows the siblings under the already-resolved parent, filtered/bounded for large folders; it must not render the entire vault.
- **Keep “Lerning” and create it** preserves the requested spelling as a new folder at that exact level and updates all descendant plan paths.
- The final create action stays disabled while any fuzzy suggestion is unacknowledged.
- Never show Levenshtein distance, similarity, thresholds, or an “AI confidence” percentage.

### Ambiguity handling

When two sibling folders are too close to choose safely, stop resolution at that segment and use targeted copy:

> More than one folder could match “client” under `Work`. Choose where this should go.

Show at most the best three sibling choices with enough parent-path context to distinguish them, plus:

- **Create new folder “client” under Work**; and
- an edit/focus affordance that returns to the destination text.

After the user chooses, continue resolving the remaining segments beneath the chosen parent and refresh the whole preview. Do not guess, search globally, or compare the unresolved segment with folders from unrelated parents.

If the parser cannot establish a reliable hierarchy, say:

> I couldn't determine the folder order. Try a path like `Learning/AI/Experiments` or “Experiments under AI inside Learning.”

Do not mutate the vault, silently fall back to root, or present a misleading completed plan while non-empty destination text remains unresolved.

### New-folder and collision behavior

- A leaf explicitly introduced by `New folder X` is a creation request. Preserve `X` verbatim (subject only to path safety validation) and **never fuzzy-correct it to an existing sibling**.
- If that requested leaf already exists after matching normalization, show an `Existing folder with this name` collision state. Let the user use the existing folder, rename the requested new folder, or cancel; never create a near-duplicate silently.
- Unknown non-explicit path segments may be proposed as new folders, but mark them clearly and require the final create confirmation. This is safe only because the exact plan is visible; it is not proof that the user intended a new folder.
- A target note-path collision in a non-empty destination plan must not silently append ` 1`, ` 2`, etc. Offer **Open existing note**, **Change title**, and **Cancel**. Never overwrite or append to the existing note from the create flow.
- Preserve the current numeric-suffix behavior only for the unchanged blank-destination/root-create path, so this feature does not unexpectedly alter existing behavior outside its scope.

### Action and confirmation behavior

Keep the shared decision shell and its far-right **Keep editing** action. When the destination plan is valid and all corrections/ambiguities are resolved, the primary **Create and jump** button is the explicit confirmation for the fully visible folder/note plan. There is no additional modal.

Disable the primary action when:

- non-empty destination text is invalid or weakly parsed;
- a path segment is ambiguous;
- a fuzzy correction has not been acknowledged;
- a folder/file collision is unresolved;
- a segment violates path or exclusion rules; or
- a create operation is already in flight.

During creation, disable the draft, title, destination field, ambiguity/correction controls, picker controls, and all decision actions together. On success, use the same sidebar, highlight, active-note, and navigation behavior as the current root create flow.

### Input lifecycle

Destination state is ephemeral and tied to the exact Quick Capture draft:

- Opening a create card for a draft initializes an empty destination field unless that unchanged draft already has preserved destination state.
- Typing destination text updates parse/resolution/preview state without modifying the capture draft.
- Parse, validation, folder-create, and note-create failures preserve the destination text, title, explicit choices, draft, and preview so the user can correct or retry.
- **Keep editing** dismisses the decision but preserves destination/title state for the same unchanged draft. Sorting that exact draft again and returning to create restores the fields.
- Any edit to the Quick Capture draft clears the destination instruction, resolution choices, title override/source state, and preview because they may target different content.
- Choosing **Search instead** does not clear the destination plan. If the user closes the picker, the same create plan returns.
- Successful append to another note, successful creation, explicit clearing of Quick Capture, or view disposal clears all destination state.
- Clearing the destination field explicitly returns the card to the root-create preview and existing root behavior.

Title precedence and lifecycle:

1. a title manually edited in the title input wins;
2. otherwise a clearly parsed explicit destination title seeds the input;
3. otherwise use `proposeTitle(draftText)`.

Track whether the title is pristine/manual so continued destination typing cannot overwrite a user's title edit. If an explicit destination title is removed before the title is manually edited, revert to `proposeTitle(draftText)`.

## Chosen approach

Implement a deterministic, dependency-free parser/resolver and a targeted create service. Keep parsing, folder matching, UI rendering, and filesystem mutation as separate layers:

1. **Parser:** converts constrained destination text into ordered requested segments, optional explicit note title, new-folder intent, and parse warnings. It performs no vault lookup and no mutation.
2. **Folder snapshot/index:** reads live `TFolder` metadata from `app.vault.getAllFolders()` and groups children by exact parent path. This is the folder source of truth; do not derive folders only from `plugin.cache`, because empty folders and excluded/unindexed notes are absent from the note cache.
3. **Resolver:** walks requested segments root-to-leaf. At each step it considers only direct child folders of the already-resolved parent, applies exact/fuzzy/new/collision policy, and emits a structured plan. User choices are transient overrides fed back into this pure step.
4. **Create service:** validates and re-preflights the accepted plan, creates missing folders parent-to-child, then creates the note at the exact target path with the exact captured content.
5. **Quick Capture UI:** owns destination text, title source/dirty state, user resolution choices, live preview, and busy/error display. It does not contain Levenshtein or path-mutation logic.

No LLM, embeddings, agent, network request, or semantic alias model is warranted. The user has already supplied the routing intent; deterministic parsing plus folder metadata is simpler, faster, local, and auditable.

## Why this approach

- Sibling-only matching prevents a typo from jumping across unrelated branches in a large vault.
- Explicit correction acknowledgement makes the synthetic fuzzy matcher useful without letting it autonomously route or create data.
- Keeping requested new leaves verbatim respects the user's creation command and avoids `meeting` silently becoming `Meetings`.
- A pure plan separates “what the user appears to mean” from irreversible filesystem changes and makes edge cases testable without Obsidian's GUI.
- A dedicated path-aware service preserves the existing write invariant while containing folder creation, collision, and partial-failure behavior.
- The design fits the current shared decision panel rather than adding another workflow surface or a full vault browser.

## Repository context

Current integration points to preserve:

- `QuickCaptureView.renderCreateCard()` creates the shared-shell create state, seeds the title, renders **Search instead**, and focuses/selects the title input.
- `QuickCaptureView.handleCreate()` snapshots the exact draft, applies the global busy guard, disables controls, calls `createNote()`, records the filed highlight/session sidebar entry, clears only the unchanged draft, and navigates to the created file.
- `QuickCaptureView.resetDecision()` currently also clears `newTitleOverride`; this needs a more precise split between “dismiss decision for same draft” and “invalidate destination/title because draft changed or filing succeeded.” Do not preserve destination state by weakening the existing stale-draft protections.
- `CreateNoteService.createNote()` currently sanitizes a title, resolves root collisions by numeric suffix, creates the file, and appends one structural trailing newline to exact user content.
- `matchesExcludePattern()` defines plugin-owned excluded destination prefixes.

The design-improvements files are currently working-tree changes in this checkout. Before implementation starts, reconcile against the accepted/merged diff and preserve the actual shared-shell and tooltip APIs if names shift. The behavior in this brief is authoritative; exact private method names are not.

## Files likely affected

- `src/view/QuickCaptureView.ts`
- `styles.css`
- `src/create/CreateNoteService.ts`
- new `src/create/FolderDestination.ts` (parser, normalization, resolver, and pure plan types; an equivalent focused name is fine)
- optional new `src/create/FolderDestination.test.ts` or `tests/folder-destination.test.ts` for the dependency-free assertion harness described below

Likely unchanged:

- `src/search/HybridSearch.ts`
- `src/search/NotePicker.ts`
- embedding/index/cache schemas
- `src/view/AnchoredTooltip.ts`, except possibly adding tooltip calls from the new UI

## Architecture

```text
Quick Capture draft (verbatim note content)
  -> unchanged sort decision
  -> create card in shared decision shell
       ├─ editable title
       ├─ Describe destination (separate routing input)
       ├─ parseDestinationInstruction(text)
       ├─ snapshotFolderTree(app.vault.getAllFolders())
       ├─ resolveFolderDestination(parsed, snapshot, user choices, balanced policy)
       ├─ structured tree preview / correction / ambiguity UI
       └─ confirmed Create and jump
            -> createNoteAtDestination(app, accepted plan, title, exact draft)
                 ├─ revalidate path + exclusions + collisions
                 ├─ create missing folders parent-to-child
                 └─ create markdown file with exact draft + structural final newline
```

The resolver is suggestion-only. A `fuzzy` result means “show this existing sibling as the recommended correction,” not “silently rewrite the destination.”

## Interfaces

Names may vary, but retain these boundaries and semantics:

```ts
interface DestinationParse {
	segments: RequestedFolderSegment[];
	explicitTitle: string | null;
	confidence: "structured" | "weak";
	warnings: string[];
}

interface RequestedFolderSegment {
	name: string;               // exact display spelling from the user
	intent: "resolve-or-create" | "create-new";
}

interface FolderSnapshot {
	// vault-relative parent path -> direct TFolder children only
	childrenByParent: ReadonlyMap<string, readonly FolderInfo[]>;
}

interface FolderInfo {
	name: string;
	path: string;
	parentPath: string;
}

interface FuzzyPolicy {
	maxDistanceShort: 1;       // normalized length <= 4
	maxDistanceMedium: 2;      // normalized length 5-8
	maxDistanceLong: 2;        // normalized length >= 9
	minimumSimilarity: 0.72;
	distanceAmbiguityMargin: 1;
	similarityAmbiguityMargin: 0.08;
}

type SegmentResolution =
	| { kind: "exact"; requested: string; folder: FolderInfo }
	| { kind: "fuzzy"; requested: string; folder: FolderInfo; acknowledged: boolean }
	| { kind: "ambiguous"; requested: string; parentPath: string; choices: FolderInfo[] }
	| { kind: "create"; requested: string; path: string }
	| { kind: "collision"; requested: string; folder: FolderInfo }
	| { kind: "invalid"; requested: string; reason: string };

interface DestinationPlan {
	status: "root" | "invalid" | "needs-confirmation" | "ambiguous" | "collision" | "ready";
	segments: SegmentResolution[];
	folderPath: string;
	noteTitle: string;
	notePath: string;
	titleSource: "capture-proposal" | "destination" | "user-edited";
	missingFolders: string[];
	warnings: string[];
}

interface DestinationChoice {
	segmentKey: string; // stable parent path + requested segment position
	resolution: { kind: "existing"; path: string } | { kind: "create"; name: string };
}

function parseDestinationInstruction(raw: string): DestinationParse | DestinationParseError;
function buildFolderSnapshot(folders: readonly TFolder[]): FolderSnapshot;
function resolveFolderDestination(
	parsed: DestinationParse,
	snapshot: FolderSnapshot,
	choices: ReadonlyMap<string, DestinationChoice>,
	policy?: FuzzyPolicy,
): DestinationPlan;

interface CreateAtDestinationRequest {
	folderPath: string;
	missingFolders: readonly string[];
	title: string;
	content: string; // exact Quick Capture draft
}

interface CreateAtDestinationResult {
	file: TFile;
	createdFolders: string[];
}

async function createNoteAtDestination(app: App, request: CreateAtDestinationRequest): Promise<CreateAtDestinationResult>;
```

Do not pass raw destination text to the filesystem service. Pass only a validated, accepted structured request, and revalidate it inside the service.

## Data structures

Add view-local, non-persisted state along these lines:

- `destinationText: string`
- `destinationPlan: DestinationPlan | null`
- `destinationChoices: Map<string, DestinationChoice>`
- `destinationDraftSnapshot: string` (ties the plan to the exact captured content)
- `titleSource: "capture-proposal" | "destination" | "user-edited"`
- `titleDirty: boolean`

Do not persist destination instructions, folder plans, edit-distance scores, or choices to vault files, plugin settings, or the note cache.

Avoid storing live `TFolder` objects in long-lived view state. Rebuild a cheap metadata snapshot when destination text/choices change and re-read the vault immediately before mutation. This prevents stale object references after folder moves/renames.

## Dependencies

No new runtime dependency. Implement normalized Levenshtein distance directly in the pure helper based on the small POC, with bounded inputs and no Python process despite the colloquial “Python Levenshtein” reference in the product discussion.

Use Obsidian's typed APIs:

- `app.vault.getAllFolders()` for live folder metadata;
- `app.vault.getAbstractFileByPath()` for preflight/collision checks;
- `app.vault.createFolder()` for missing folders; and
- `app.vault.create()` for the final Markdown file.

Use `normalizePath()` only after raw segments pass validation. Do not treat normalization as traversal protection.

## Parser and resolution policy

### Normalization

For comparison only:

1. trim;
2. Unicode-normalize consistently (NFKC);
3. lowercase using a stable locale-independent transformation;
4. treat `-`, `_`, and repeated whitespace as a single space; and
5. remove only comparison punctuation with a Unicode-aware rule.

Never apply the normalized value to a created folder's display name. Preserve the user's original segment spelling after validation. Do not add phonetic matching, stemming, plural folding, abbreviations, or semantic aliases in this version.

### Exact and fuzzy matching

At each segment, compare only with direct folder children of the resolved parent:

1. normalized exact match -> `exact`;
2. otherwise compute normalized Levenshtein distance and `1 - distance / max(lengths, 1)`;
3. the best candidate is eligible only when it meets both the length-tier distance cap and `.72` minimum similarity;
4. if the next-best sibling is within one edit of the best **or** within `.08` similarity, return `ambiguous` rather than a fuzzy proposal;
5. a prefix-like candidate below the normal threshold may be shown only as an ambiguous choice, never as a correction (the POC used a `.55` similarity floor for this fallback);
6. if no candidate qualifies, emit a proposed new folder.

Balanced length tiers, selected by the POC:

| normalized requested length | maximum edit distance |
| --- | ---: |
| `<= 4` | `1` |
| `5-8` | `2` |
| `>= 9` | `2` |

These are initial product defaults, not universal truths. Keep them as named constants in one module so real-vault evidence can tune them later.

### Requested new-folder leaf

If grammar marks a segment as the leaf of `New folder X`:

- do normalized exact collision detection only;
- if no exact collision exists, emit `create` with the original spelling;
- do not run fuzzy substitution for that leaf;
- continue to fuzzy-resolve its ancestor segments normally.

For example, `New folder Natrual Language Processing under Learning/AI` must plan a new folder with that exact requested spelling unless the user edits it; it must not silently select existing `Natural Language Processing`.

## Implementation steps

1. **Reconcile the accepted design-improvements diff.** Confirm the current `QuickCaptureView`, shared decision shell, `AnchoredTooltip`, create-card action ordering, and styles. Keep the new flow inside `renderCreateCard()` (or its accepted equivalent).
2. **Port the research algorithm into a production-quality pure module.** Define the parser, safe comparison normalization, Levenshtein helper, folder snapshot, sibling-only resolver, balanced policy constants, structured plan statuses, and user-choice overrides. Do not copy the POC's synthetic tree, mixed tuple/override fixtures, console runner, or research-only expected-action maps into production.
3. **Build the folder snapshot from `app.vault.getAllFolders()`.** Group direct children by parent path once per preview recomputation. Exclude the root from ordinary sibling choices but represent it with an empty folder path.
4. **Add focused deterministic checks.** Convert the important POC cases into explicit production-module assertions, including segment actions rather than only final paths. Add Unicode/path-validation cases not covered by the POC.
5. **Add path-aware creation to `CreateNoteService`.** Keep `createNote()` for blank-destination root behavior. Add `createNoteAtDestination()` for accepted non-empty plans, with defense-in-depth validation, exclusion checks, exact collision behavior, parent-to-child folder creation, and a structured partial-failure result/error.
6. **Split decision reset semantics.** Destination/title state must clear on draft edits and successful filing but survive **Keep editing**, parser errors, picker open/close, and create failures for the unchanged draft. Preserve the existing draft snapshot and global busy protections.
7. **Extend the create-card UI.** Add destination label, compact textarea, helper/examples, structured tree preview, final path, title source, correction acknowledgement controls, ambiguity choices, collision actions, and safe inline errors. Use existing tokens, shared actions, focus rings, and anchored tooltips.
8. **Implement title precedence.** Track pristine/manual title state; apply a parsed explicit title only when pristine; never replace a manual edit during subsequent destination typing.
9. **Wire plan confirmation to the create handler.** Snapshot the draft, title, destination plan, and relevant DOM references before `await`; disable every decision control; call root `createNote()` only when destination is blank and `createNoteAtDestination()` otherwise. On success, reuse current highlight/sidebar/navigation/reset behavior.
10. **Re-preflight immediately before mutation.** Re-read folder/file state, recalculate target paths, reject newly introduced ambiguities/collisions, and ensure the accepted destination still matches. A stale plan must return to review, not create somewhere else.
11. **Add responsive styles.** Keep the preview bounded in the decision card; wrap long path segments; indent the tree without relying only on color; ensure correction/ambiguity controls work in narrow leaves; never render a whole-vault folder tree.
12. **Verify in layers.** Run the production parser assertions, TypeScript, production esbuild, `git diff --check`, and code-trace cases. Then hand the manual Obsidian script to the user and distinguish what the agent ran from what still needs real-vault click-through.

## Edge cases

### Parsing and resolution

- Empty/whitespace destination -> root preview and unchanged root create behavior.
- `/`, `>`, mixed separators, repeated spaces, harmless filler words, case differences, and nested relational chains.
- Explicit quoted title vs no title; folder named `note`; a title containing `under` inside quotes.
- Unknown first segment, unknown intermediate segment, and unknown final segment. Once a new ancestor is chosen, descendants are necessarily new within that new branch; show that explicitly rather than fuzzy-matching them globally.
- Exact folder match differing only in case/separator normalization.
- Two close sibling candidates -> ambiguity, even if one is slightly closer.
- One close sibling candidate -> displayed fuzzy proposal requiring acknowledgement.
- Requested `New folder` leaf close to an existing sibling -> retain requested spelling, except exact normalized collision.
- Folder renamed/deleted/created after preview but before confirmation.
- Very deep path, very long segment, Unicode names, emoji, combining marks, and composed/decomposed equivalents.
- Weak/vague language (`Put it in Learning AI`, `Make a folder for experiments`) -> instruction/help state, not silent routing.
- Abbreviations and semantic aliases (`NLP` vs `Natural Language Processing`) -> do not infer equivalence.

### UI and state

- Destination typing must not rerender/replace the textarea in a way that loses caret or composition state; update the preview region locally where practical.
- IME composition: do not parse half-composed text as a committed instruction.
- Title manually edited before/after an explicit title appears in destination text.
- **Keep editing**, sort again without draft change, then return to create -> state restored.
- Draft edit by one character -> destination/title/choices cleared.
- Picker open/close from the create card -> destination plan preserved.
- Long final path wraps without displacing the shared far-right **Keep editing** action.
- Keyboard focus order covers title, destination, correction/ambiguity choices, primary action, **Search instead**, and **Keep editing**; visible focus treatment is retained.
- Fuzzy/ambiguous meaning is conveyed by labels/text, not color alone.

### Filesystem

- Parent path is occupied by a Markdown file rather than a folder.
- Target note exists with same normalized/case-sensitive path.
- Two rapid creates; plan becomes stale between click and filesystem call.
- `createFolder()` succeeds for some ancestors, then a later folder or note creation fails.
- An excluded folder prefix, `.obsidian`, absolute path, traversal segment, empty segment, backslash separator, reserved/illegal filename characters, or platform-sensitive trailing dot/space.
- Root vs nested note collision behavior is intentionally different and clearly documented.
- Exact draft is empty only by impossible/stale UI state; service still rejects unintended empty operations consistently with current view rules.

## Failure handling

- Parser/validation failures render inline, actionable copy and preserve both inputs. Do not use a generic Notice for expected instruction corrections.
- Resolver ambiguity/correction/collision is a review state, not an exception.
- Before mutation, validate every raw segment and the final normalized vault-relative path. Reject absolute paths, `.`/`..`, `.obsidian` (case-insensitive), empty segments, control characters, unsupported separators, illegal filename characters, and any path matching `plugin.settings.excludePatterns` via `matchesExcludePattern()`.
- If the live vault differs from the preview, abort before creating anything when possible, refresh the plan, and explain what changed.
- Folder creation is not atomic. Track folders created during the current attempt. If a later step fails, do not automatically delete them: another plugin/event may already have used them. Preserve the draft/plan and report exactly which folders were created and that the note was not created.
- If a concurrent actor creates an intended folder, accept it only if the live object is a `TFolder` with the exact accepted path; otherwise stop.
- If note creation succeeds but UI navigation/render fails, do not retry creation. Record/update sidebar state as far as possible and tell the user the exact created path to avoid duplicates.
- Never clear the draft, destination state, or title on any failed create.

## Security and privacy considerations

- Entirely local: no hosted API, Ollama call, telemetry, shell, Python process, or note-body analysis.
- Destination parsing uses only the typed destination text and vault-relative folder metadata.
- Render all user/folder/title strings with DOM text APIs, never `innerHTML`.
- Never expose absolute adapter paths.
- Treat raw path text as untrusted until segment validation completes. Validate before and after `normalizePath()`.
- Block plugin-excluded paths so a newly created note does not immediately disappear from this plugin's search model. If product policy later wants excluded-folder creation, that needs a separate explicit decision.
- Preserve the append-text invariant: the exact Quick Capture draft is the only content payload. Destination text, correction labels, inferred title metadata, and preview text never enter the Markdown body.
- Do not overwrite, append to, rename, or delete an existing file/folder as part of collision handling.

## Performance constraints

- Parser and resolver are synchronous, local, and model-free.
- Build a compact parent-to-direct-children map from `getAllFolders()`; never render all folders or compare each segment against the whole vault.
- Resolution cost should be `O(folder count)` to build the snapshot plus `O(sum of sibling counts × edit-distance cost)` for one plan.
- Bound ambiguity/alternate UI to three initial candidates; filter on demand if the user asks to choose another folder.
- Cap destination input length (recommended 500 characters), segment count (recommended 20), individual segment length (recommended 200 before platform validation), and Levenshtein matrix work. A two-row dynamic-programming implementation is sufficient; no full matrix retention is needed.
- Live preview should feel immediate in a large vault. If real profiling shows input jank, debounce preview recomputation by 75-100 ms with a monotonically increasing request/version guard. Do not add debounce preemptively without evidence.
- Do not scan note bodies, recompute embeddings, or call hybrid search from destination input.

## Evidence status

### Synthetic experimental evidence

The standalone POC was rerun on 2026-08-01 with:

```sh
node research/experiment-results/folder-destination-poc/poc.js
```

It uses one synthetic nested tree and 54 labeled English examples: 20 calibration/train and 34 held-out. Complete-plan scoring checks the final path, optional title, status, and per-segment action (`exact`, `fuzzy`, `create`, `ambiguous`, or `collision`).

| policy | calibration complete-plan accuracy | held-out complete-plan accuracy | held-out false automatic correction | held-out ambiguity |
| --- | ---: | ---: | ---: | ---: |
| strict | 18/20 (90.0%) | 34/34 (100.0%) | 0 | 2 |
| balanced | 19/20 (95.0%) | 34/34 (100.0%) | 0 | 2 |
| loose | 19/20 (95.0%) | 33/34 (97.1%) | 1 | 1 |

The selection rule used calibration data only: maximize complete-plan accuracy, then minimize false automatic corrections, then prefer the less permissive policy. That selects balanced over loose. Balanced held-out diagnostics were parser 33/34 (97.1%), ancestor resolution 34/34, requested-leaf create/collision 23/23, zero false automatic corrections, and two ambiguity outcomes.

The POC supports these design decisions:

- sibling-only ancestor resolution is a credible bounded strategy;
- the `1/2/2`, `.72`, and ambiguity-margin defaults are worth an implementation trial;
- explicit new-folder leaves should not be fuzzy-substituted; and
- parser failure, ambiguity, and collisions need distinct outcomes.

### Real-vault unknowns

None of the following is verified:

- accuracy on the user's real folder names or natural phrasing;
- behavior with large/deep vaults, Unicode-heavy paths, acronyms, plural variants, or semantic aliases;
- interactive latency inside Obsidian;
- cross-platform filename behavior;
- usability of the correction/ambiguity copy and tree preview; or
- correctness under real concurrent folder changes and partial I/O failures.

The POC grammar is constrained English and the fixture is synthetic. Its 34/34 held-out result must not be described as real-world accuracy, a production benchmark, or evidence for autonomous routing. The product remains confirmation-based. Do not relax thresholds or remove acknowledgement based on these results.

## Acceptance criteria

1. The post-design-improvements create card includes a separate optional **Describe destination** textarea without changing the captured-note textarea or shared decision-shell structure.
2. The original Quick Capture draft remains the exact new note content; destination text never appears in the note body.
3. Empty destination text preserves the existing root-create path and title behavior.
4. Supported path/relational instructions produce an ordered live tree showing existing folders, new folders, the note, title source, and exact final vault-relative path.
5. Folder metadata comes from the live vault folder tree, including empty folders; no full-vault folder browser is rendered.
6. Resolution is strictly sibling-by-sibling beneath the already-resolved parent. No global fuzzy folder lookup occurs.
7. Balanced matching uses maximum edit distances `1/2/2` for normalized lengths `<=4`, `5-8`, and `>=9`, requires similarity `>=.72`, and treats next-best siblings within one edit or `.08` similarity as ambiguous.
8. Every fuzzy proposal visibly shows requested and matched names and requires explicit acknowledgement before creation. Scores/thresholds are never shown to the user.
9. Ambiguity stops the plan at the affected segment, uses targeted copy, offers bounded sibling choices plus explicit folder creation, and never guesses.
10. A leaf explicitly requested with `New folder X` is never fuzzy-corrected; it is either planned verbatim as new or shown as an exact normalized collision.
11. Explicit destination titles seed the title only while it is pristine; manual title edits always win; absent explicit titles use `proposeTitle(draftText)`.
12. Invalid/weak non-empty instructions, unsafe paths, excluded destinations, unacknowledged corrections, ambiguities, and collisions disable targeted creation without silently falling back to root.
13. Non-empty destination note collisions never overwrite, append, or silently numeric-suffix. The UI offers open existing/change title/cancel.
14. A valid visibly reviewed plan creates missing folders parent-to-child and then creates the Markdown note at the exact displayed path.
15. The service re-preflights live folder/file state immediately before mutation; stale plans abort and return to review.
16. Destination/title/choice state survives expected correction and create failures, picker open/close, and **Keep editing** for the same draft; any draft edit and every successful filing clear it.
17. Busy guards disable all relevant fields, choices, picker controls, rows, and actions. Rapid clicks/Enter cannot create two notes.
18. Partial folder creation failures report created folders, preserve the draft and plan, and do not auto-delete folders.
19. Successful targeted creation produces the same session-sidebar, filed-highlight, active-note, and jump behavior as current root creation.
20. Parser/resolver assertions, TypeScript, production esbuild, and `git diff --check` pass. The Completion Report separates these checks from real-vault GUI verification.

## Test plan

### Automated pure parser/resolver checks

Use a dependency-free TypeScript assertion entry point bundled temporarily with the repo's existing esbuild and run with Node. Do not introduce a test framework solely for this feature. Port cases as explicit objects with expected parse/status/path/per-segment actions; do not preserve the POC's research-only tuple override maps.

Minimum matrix:

- all five documented instruction shapes;
- exact nested path and case-normalized match;
- one typo in short, medium, and long segments at the balanced threshold;
- candidates just outside each threshold;
- two siblings within one edit / `.08` similarity -> ambiguity;
- sibling with similar name under the wrong parent -> never considered;
- explicit `New folder` leaf near an existing sibling -> verbatim create;
- explicit leaf exact normalized collision -> collision;
- unknown intermediate segment -> it and descendants shown as new;
- explicit quoted title, title containing `under`, no explicit title, and weak title grammar;
- slash, `>`, relational chains, filler words, repeated spaces;
- Unicode normalization and display-spelling preservation;
- traversal, absolute path, `.obsidian`, illegal characters, empty segment, excessive depth/length;
- target folder occupied by a file and target note collision;
- excluded prefix;
- all POC cases that drove balanced-policy selection.

Report calibration/held-out POC results as prior synthetic evidence, not as the new production module's test result. The production assertions should have their own pass/fail output.

### Static and code-trace verification

- Trace destination state through create-card entry from low-confidence, empty-index, and force-create paths.
- Trace title precedence for destination title add/change/remove and manual title edits.
- Trace **Keep editing**/sort-again, draft edit, picker open/close, root create, targeted create, create error, successful append elsewhere, and successful creation.
- Confirm the exact captured draft snapshot—not `.trim()` and never destination text—reaches the service.
- Confirm all mutation paths pass through one busy guard and all live controls are disabled.
- Confirm the service revalidates all segments/path/collisions/exclusions, creates folders in order, and records partial success.
- Confirm root `createNote()` behavior is unchanged and targeted create cannot silently suffix.
- Confirm folder snapshot uses `getAllFolders()` and matching never scans note bodies or invokes embeddings/search.
- Run `npx tsc --noEmit` (or the repo-equivalent TypeScript command), `npm run build`, and `git diff --check`.

### Manual Obsidian verification required

No agent in this environment can drive Obsidian's GUI. The user must reload the plugin in a real test vault and click through:

1. Create a fixture tree with close siblings (`Client A`, `Client B`), an empty folder, an excluded folder, and an existing target note.
2. Reach each create-card entry path: low confidence, empty index where practical, and **Create new note** from confident/ambiguous.
3. Leave destination blank; confirm root creation and existing suffix behavior remain unchanged.
4. Enter `New folder abc under AI folder which is inside Learning`; verify the exact tree/final path, inferred-title label, and created file content.
5. Enter a minor ancestor typo; verify requested -> suggested correction is visible and creation is blocked until accepted.
6. Choose another sibling, then choose keep spelling/create; verify each preview and final path.
7. Enter an ambiguous sibling term; verify no folder is selected automatically and each choice resolves descendants under the chosen parent.
8. Request a new leaf close to an existing folder; verify it remains verbatim. Then request an exact normalized existing leaf; verify collision choices.
9. Supply an explicit quoted note title, manually edit it, then continue editing destination text; verify the manual title is preserved.
10. Test invalid/vague/traversal/absolute/`.obsidian`/excluded destinations; verify inline error, disabled create, and no filesystem mutation.
11. Create a note-path collision; verify open/change/cancel and no suffix/overwrite/append.
12. Use **Keep editing**, sort unchanged text again, and verify destination state returns. Edit the capture draft and verify all destination/title choices clear.
13. Open/close **Search instead** and verify destination state remains. Select an existing note and verify the existing append flow remains unchanged.
14. Trigger a controlled failure after at least one folder is created if feasible; verify the notice lists created folders, leaves them intact, preserves all input, and does not claim the note exists.
15. Test keyboard navigation, IME if relevant, long/Unicode paths, narrow panes, focus rings, tooltip positioning, and responsive wrapping.
16. Inspect the resulting Markdown file byte-for-byte: captured text is preserved with only the service's established structural final newline, and destination instruction is absent.

The Completion Report must explicitly list which manual steps a human actually ran. Passing TypeScript/esbuild and code tracing is not a GUI or real-vault product pass.

## Explicitly out of scope

- Automatic folder inference from the captured note's content or from low-confidence AI result paths.
- Arbitrary natural-language understanding, LLM parsing, embeddings, agents, hosted APIs, Ollama, semantic aliases, acronym expansion, phonetic matching, or translation.
- Reintroducing `@tag` pre-targeting.
- A full-vault folder tree/browser in the Quick Capture sidebar or decision card.
- Moving/appending to an existing note from the destination parser; **Search instead** remains the existing-note override.
- Renaming, moving, merging, overwriting, appending to, or deleting existing files/folders.
- Persisting destination history, learned aliases, user-specific thresholds, telemetry, or accepted corrections.
- Relaxing plugin exclude rules or integrating Obsidian's undocumented core exclusion settings.
- Changing hybrid search, confidence/margin logic, embeddings, cache schema, indexing, relative match bars, tooltip architecture, or session-sidebar scope.
- General filesystem transactions/rollback. The feature reports partial folder creation and leaves recovery to the user.
- Tuning balanced thresholds from the synthetic POC alone.

## Questions requiring human approval

None required before implementation. The following defaults are deliberately fixed for this pass:

- destination is optional and blank preserves root creation;
- fuzzy proposals always require visible acknowledgement;
- explicit new-folder leaves are never fuzzy-corrected;
- non-empty targeted note collisions never numeric-suffix;
- plugin-excluded destinations are blocked;
- constrained English/path grammar is presented honestly; and
- balanced POC thresholds are initial constants pending real-vault evidence.

If implementation evidence makes any of those impossible without materially expanding scope, stop and return a focused decision request rather than silently changing the product behavior.

