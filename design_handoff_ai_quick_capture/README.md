# Handoff: AI Quick Capture (in-note note routing)

## Overview
A note-taking app (Obsidian-style) feature: the user writes a quick, untitled thought directly in a "Quick Capture" note (a normal editor, not a chatbot). When ready, they trigger sorting and the AI proposes where the text belongs — append to an existing note it matches confidently, let the user pick among a few plausible notes, or create a new note — then jumps them to the result. This replaces an earlier sidebar-chatbot pattern with something that lives inside the note-editing surface itself.

## About the Design Files
The files in this bundle (`AI Quick Capture Prototype v2.dc.html`) are **design references built in HTML** — an interactive prototype demonstrating layout, states, and behavior. They are not production code to copy directly. The task is to **recreate this design in the target codebase's existing environment** (the Obsidian plugin API + whatever UI framework the codebase uses, e.g. vanilla TS/React) using its established patterns — not to ship the HTML.

## Fidelity
**High-fidelity.** Colors, typography, spacing, radii, and interaction states below are final and should be recreated precisely.

## Screens / Views

All views live inside one two-pane window: a left note-list sidebar (180px) and a right note-editing pane (flex 1), inside a rounded container (16px radius) on a near-black backdrop.

### 1. Sidebar (persistent, all states)
- Width 180px, background `#141415`, right border `1px solid rgba(255,255,255,.06)`, padding `20px 12px`.
- Section label "Notes": 10px, weight 600, `rgba(255,255,255,.32)`, letter-spacing `.09em`, uppercase, padding `2px 8px 12px`.
- Nav rows (one per note, "Quick Capture" always first): 12px font, padding `8px 10px`, border-radius 8px, gap 2px between rows.
  - Active row: font-weight 600, color `#f4f4f5`, background `oklch(63% 0.13 296 / 16%)` (soft violet tint).
  - Inactive row: font-weight 400, color `rgba(255,255,255,.5)`; hover background `rgba(255,255,255,.045)`, hover color `rgba(255,255,255,.8)`.
  - Transition: `background .15s ease`.

### 2. Quick Capture note (default view)
- Note title header: 21px, weight 650, `#f4f4f5`, letter-spacing `-0.01em`, padding `28px 32px 6px`.
- Body: a plain multiline text input filling remaining height, no border/background, `14–15px`/`1.8` line-height, color `#e4e4e7`, placeholder "Write a quick note — sort it after." Padding `6px 32px 26px` on the containing column, `2px` on the textarea itself. Editing text always resets any pending routing decision below.
- **Empty-state suggestions**: when the note is empty, show "or try one" (10.5px, `rgba(255,255,255,.3)`) above 3 example chips — full-width-left-aligned pill-ish buttons, `rgba(255,255,255,.035)` background, `1px solid rgba(255,255,255,.07)` border, 9px radius, 12px text `rgba(255,255,255,.55)`; hover background `rgba(255,255,255,.07)`, hover text `rgba(255,255,255,.8)`. Clicking a chip fills the note text (does not auto-sort).
- **Sort action**: once there is text and no decision is showing, a right-aligned pill button "Sort this note" appears — `oklch(63% 0.13 296)` background, `oklch(98% 0.01 296)` text, 12.5px/weight 600, padding `9px 16px 9px 18px`, fully rounded, subtle shadow + 1px accent ring; hover darkens to `oklch(58% 0.14 296)`.

### 3. Routing decision — confident match
Shown inline below the text after Sort, inside a soft card: `rgba(255,255,255,.035)` background, `1px solid rgba(255,255,255,.08)` border, 12px radius, 16px padding.
- Header row: destination note title (12.5px, weight 600, `#f4f4f5`) left, match badge right — pill, `rgba(255,255,255,.07)` background, `rgba(255,255,255,.5)` text, 10.5px, e.g. "92% match".
- Excerpt line: 11.5px, `rgba(255,255,255,.42)`, e.g. "...check travel docs before we...".
- Three actions (all fully-rounded pills, 12px/weight 600 or 500, 8px gap, wrap on overflow):
  - **Add and jump** — primary (accent fill), navigates to the destination note.
  - **Add and stay here** — secondary (`1px solid rgba(255,255,255,.1)` border, transparent fill, `#e4e4e7` text; hover `rgba(255,255,255,.06)` fill) — files the note but keeps the user on Quick Capture.
  - **Keep editing** — ghost (`rgba(255,255,255,.4)` text; hover `rgba(255,255,255,.7)`) — dismisses the decision, text stays in Quick Capture unfiled.

### 4. Routing decision — ambiguous match
Same card chrome as above.
- Copy: "A few notes could match — pick one" (11.5px, `rgba(255,255,255,.45)`).
- A list of candidate rows (here: 2), each: `rgba(255,255,255,.04)` background, 9px radius, `9px 12px` padding, transparent 1px border that turns `oklch(63% 0.13 296 / 60%)` on hover; row shows note title (12px/weight 600, `#f4f4f5`) and a match-percent badge (same badge style as above, e.g. "61%", "58%"). Clicking a row files the note there and jumps.
- Below the list: "+ New note instead" (secondary pill, flex-fill) switches to the create state; "Keep editing" (ghost) dismisses.

### 5. Routing decision — create new note
Same card chrome.
- Copy: "No confident match — new note" (11.5px, `rgba(255,255,255,.45)`).
- An editable title field, pre-filled with an auto-guessed title (first ~4 words of the note, capitalized): dark input, `rgba(0,0,0,.25)` background, `1px solid rgba(255,255,255,.1)` border, 9px radius, `9px 12px` padding, 12.5px text `#f4f4f5`.
- Actions: **Create and jump** (primary pill) creates the note and navigates to it; **Back** (ghost) returns to the ambiguous/plain editing state without losing the typed text.

### 6. Destination note (after jump)
- Same title-header + body layout as Quick Capture, but body renders static paragraphs (not editable) instead of a textarea, 14px/1.85 line-height.
- The just-filed line renders as a highlighted callout: `oklch(63% 0.13 296 / 16%)` background, `2px solid oklch(63% 0.13 296)` left border, `5px 10px` padding, 8px right-side radius (flat left edge) — makes clear which line was just added by the AI.

## Interactions & Behavior
- Typing in the Quick Capture textarea at any time clears a pending decision card (edits invalidate the last routing proposal).
- Sort button only shows when there is non-empty text and no decision is currently shown.
- Routing logic in the prototype is a stand-in keyword matcher for demo purposes only (real implementation should call the actual note-matching/embedding service):
  - text mentioning "passport"/"trip" → confident match to the Journal note.
  - text mentioning "dentist"/"book" → ambiguous match (Journal vs. Travel Prep Checklist).
  - anything else → no match, offers to create a new note titled from the first ~4 words.
- No animation/transition beyond simple color/background transitions (150ms ease) on hover and button state changes.
- Clicking a sidebar note switches the main pane to that note's static content.

## State Management
Minimal local state needed:
- `activeNoteId` — which note is currently open in the main pane.
- `draftText` — current Quick Capture textarea content.
- `sorted` (boolean) — whether a routing decision is currently displayed.
- `forceCreate` (boolean) — user explicitly chose "new note instead" from the ambiguous state.
- `newTitleOverride` — user-edited title for the create-new-note state (falls back to an auto-guessed title).
- Per-note appended/highlighted line(s) — the text that was just filed into a note, so it can render as a highlighted callout.
- List of any newly created notes (id, title, content) so they appear in the sidebar.

State transitions: edit textarea → clears `sorted`/`forceCreate`; Sort → `sorted:true`; Add/jump actions → clears draft, marks the target note's highlighted line, optionally switches `activeNoteId`; "+ New note instead" → `forceCreate:true` + seeds title guess; Back/Keep editing → clears `sorted`/`forceCreate` without losing the draft text.

## Design Tokens

**Colors**
- Backdrop: `#0a0a0b`
- Window background: `#18181a`; window border `rgba(255,255,255,.07)`; window shadow `0 30px 90px rgba(0,0,0,.55)` + `0 1px 0 rgba(255,255,255,.04) inset`
- Sidebar background: `#141415`; sidebar border `rgba(255,255,255,.06)`
- Primary text: `#f4f4f5`; secondary/body text: `#e4e4e7`
- Muted text: `rgba(255,255,255,.3–.5)` (varies by context, see above)
- Accent (brand): `oklch(63% 0.13 296)`, hover `oklch(58% 0.14 296)`, on-accent text `oklch(98% 0.01 296)`, soft tint `oklch(63% 0.13 296 / 16%)`
- Card surfaces: `rgba(255,255,255,.035)` background, `rgba(255,255,255,.08)` border
- Chip/badge surfaces: `rgba(255,255,255,.07)` / `rgba(255,255,255,.04)`

**Typography**: system font stack (`-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`).
- Note title: 21px / weight 650 / letter-spacing -0.01em
- Body text: 14–15px / line-height 1.8–1.85
- Card copy: 11.5–12.5px
- Labels/badges: 10–10.5px

**Radius scale**: 8px (nav rows, list rows), 9px (chips, inputs), 12px (decision cards), 16px (window), 999px (all buttons — fully pill-shaped)

**Spacing**: 32px horizontal pane padding, 28px/6px title padding, 8–16px internal card padding, 6–14px gaps between stacked blocks.

## Assets
No external images or icons — pure typography, color, and shape. No brand/logo assets used.

## Files
- `AI Quick Capture Prototype v2.dc.html` — the full interactive prototype (all states above are reachable by typing/clicking in the file itself).
