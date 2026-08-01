# Quick Capture — design improvement notes

Scope: the Quick Capture note + "sort this note" matching flow, based on the current build.

## 1. Sidebar / icon rail

**Current:** Inbox, Notes, Graph, Dashboard, Calendar, Files, Terminal, Tools — flat list, no grouping, no labels visible.

**Issues:**
- No visual grouping. Every icon carries equal weight, so there's no way to tell "core content nav" from "utility."
- Missing: dedicated search, tags, archive, settings. Settings is absent entirely — currently has no home.
- Terminal + Tools sit isolated at the bottom with no explanation for why.

**Fix:**
- Group with a hairline divider into three tiers:
  1. Capture / search — Inbox, Search
  2. Content nav — Notes, Graph, Dashboard, Calendar, Files, Tags, Archive
  3. Utilities — Terminal, Tools, Settings
- Add Search, Tags, Archive, Settings as first-class icons.
- Add hover labels or tooltips on all icons — 8+ unlabeled icons in a column is a guessing game for new users.

## 2. Quick capture empty state

**Current:** Placeholder text "Write a quick note — sort it after." rendered in low-contrast gray on a dark card; no visible cursor.

**Issues:**
- Placeholder contrast is low enough to read as a disabled field, not an empty one.
- No affordance that the field is ready to type into (no cursor, no focus ring shown).
- Placeholder describes the feature instead of showing a realistic example input.

**Fix:**
- Use a concrete example as the placeholder ("Summarize this document") rather than a description of what the field does.
- Show a visible text cursor / focus state by default so the field doesn't read as inert.
- Bump placeholder text color up a step for legibility.

## 3. Tooltip anchoring (recurring bug)

**Current:** Tooltips ("Quick capture note", "New note title") render detached below their trigger element, floating near the bottom of the viewport instead of next to the control they describe.

**Issue:** This is a component-level bug — it shows up on at least two different triggers across the flow, not a one-off placement mistake.

**Fix:** Anchor tooltips directly to their trigger with a connecting pointer/arrow, positioned above or below the element itself, not fixed to a page region.

## 4. Spellcheck on the capture field

**Current:** Red squiggly spellcheck underline appears under freeform text ("fewfwe") in the capture box.

**Fix:** Disable browser spellcheck (`spellcheck="false"`) on this input — it's a scratchpad, not prose, and the squiggle adds visual noise for shorthand/fragment input.

## 5. "Sort this note" — match panel

**Current:** After clicking sort, a panel appears showing three candidate notes with raw match percentages (43%, 40%, 34%), plus "Search notes instead," "+ New note instead," and "Keep editing" buttons.

**Issues:**
- Raw percentages don't mean anything to a user without a reference point — 43% could be "strong" or "weak" depending on the matching model, and nothing on screen says which.
- Button hierarchy is inconsistent with the no-match panel (see below): "Search notes instead" sits alone above the primary row here, but appears differently positioned in the other state.
- The wide "+ New note instead" pill visually reads as the primary action even though it's the fallback option, not the top match.

**Fix:**
- Replace percentages with a lightweight confidence bar (visual, relative) and reserve a badge like "best match" for the top result only.
- Standardize one action row across both panel states: `[Use top match] [Create new note] [Search instead] ... [Keep editing]`, with "Keep editing" always pinned to the same position (far right) so it becomes muscle memory.
- Accent the top match's row (border or background) so the eye lands there first.

## 6. "No confident match" panel

**Current:** Shows a pre-filled, pre-selected text input for the new note's title, with "Create and jump," "Back," and "Search notes instead" buttons, plus a detached tooltip bug (see #3).

**Issues:**
- Layout doesn't match the match-found panel — different button grouping, different spacing, no shared visual language between the two states of what is functionally one feature.
- "Back" as a label is ambiguous — back to what? Rename to match the other panel's "Keep editing" for consistency, since it's the same action (return to the capture box without committing).

**Fix:**
- Reuse the same panel shell and action-row layout as the match panel (see #5) — same divider, same button order, same "Keep editing" position.
- Rename "Back" → "Keep editing" to match its counterpart in the other state.

## 7. Overall flow coherence

**Current:** The three states (empty capture → match found → no match) each look like separately designed screens rather than one connected flow.

**Fix:** Treat "sort this note" as a single component with two possible result states, not two different UI patterns. Shared elements across both states:
- Same panel container, corner radius, and entrance position (docked to the bottom of the capture card, not floating independently)
- Same action-row order and "Keep editing" placement
- Same tooltip anchoring behavior once #3 is fixed

## Priority if scoping for a sprint

1. Tooltip anchoring bug (#3) — affects multiple screens, easy fix, currently looks broken
2. Unify match / no-match panel layouts (#5, #6, #7) — biggest coherence win for least design effort
3. Placeholder contrast + cursor affordance (#2)
4. Sidebar grouping + missing icons (#1) — larger scope, can be phased
5. Spellcheck toggle (#4) — trivial, low priority
