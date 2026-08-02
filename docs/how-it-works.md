# How Amnesiarch works

## The core loop: Capture, then Sort

Amnesiarch's whole workflow is one loop:

1. Write a fleeting thought into the Quick Capture text box, in whatever words come naturally.
2. Click **Sort this note**.
3. Amnesiarch shows you where it thinks that thought belongs, and you confirm (or redirect) it.
4. Your exact typed text lands in a note, and you're jumped to it.

Amnesiarch doesn't guess silently — every path ends with something on screen for you to look at
before anything is written. And whatever gets written into a note is always **exactly the text
you typed** into Quick Capture. Amnesiarch's automation only ever decides *where* your thought goes,
never rewrites *what* it says.

Sorting looks at your existing notes' content, titles, folders, and tags together, so it can
find the right note even if your typed wording doesn't match the note's title or heading
exactly. Everything runs on your device — see
["What stays on your device"](#privacy-what-stays-on-your-device) below.

## The three outcomes of Sort

After you click **Sort this note**, Amnesiarch lands on one of three screens.

### Confident match

Amnesiarch found one note it's confident is the right destination. You'll see that note's title, a
short preview of its current content, and a relative strength indicator (a bar, not a raw
percentage — it shows how much stronger this match is than your vault's other candidates, not
an absolute "correctness" score).

From here you can:

- **Add and jump** — append your captured text to that note and open it.
- **Add and stay here** — append it, but stay in Quick Capture so you can keep capturing.
- **Create new note** — if Amnesiarch's guess is wrong, skip straight to creating a new note instead
  (see ["Creating a new note"](#creating-a-new-note-the-create-at-composer) below).
- **Search instead** — manually search your vault by title or path and pick a different note
  yourself (see ["Search instead"](#search-instead-manually-picking-a-note) below).
- **Keep editing** — discard this result and go back to editing your draft.

### A few notes could match

If Amnesiarch found more than one plausible destination without a clear front-runner, it shows up to
three candidates instead of guessing on your behalf. Click any candidate to append and jump to
it immediately — no separate confirm step, since clicking a specific note *is* the confirmation.
The same **Create new note**, **Search instead**, and **Keep editing** actions are available
here too.

### New note

If nothing in your vault looks like a good fit — or if you have no notes indexed yet — Amnesiarch
offers to create a new note for your captured text instead of dead-ending. This is also where
you land if you clicked **Create new note** from either of the screens above. See the next
section for how to point the new note at a folder.

## Search instead: manually picking a note

On any of the three screens, **Search instead** opens a small local search box where you can
type a note's title or path directly and pick it yourself, instead of trusting Amnesiarch's
suggestion. This search only looks at titles and file paths (it's not the same AI-powered
search Sort uses) and never leaves your device. Picking a result gives you the same **Add and
jump** / **Add and stay here** choice as a confident match.

## The Back button

If you clicked **Create new note** from a confident-match or a-few-notes-could-match screen
(because Amnesiarch's suggestion wasn't right), the new-note screen shows a **Back** button. Clicking
it returns you to that exact previous screen — same candidate(s), same order — without
re-running the search, so you can reconsider or pick a different candidate. Anything you'd
already started typing in the destination field is preserved, so if you click **Create new
note** again you're back where you left off.

**Back** only appears when there's a real previous screen to return to. If you landed on the
new-note screen automatically (no confident match, or no notes indexed yet), there's nothing to
go back to — only **Keep editing**, which discards the whole decision and returns you to a
blank editing state (your typed destination for this same draft is still preserved if you Sort
again).

## Creating a new note: the "Create at" composer

When you're on the new-note screen, the **Create at** field lets you type where the new note
should live, one folder at a time, instead of always creating at your vault's root.

As you type, Amnesiarch checks only the folders that are direct children of wherever you currently
are (starting at the vault root) — never a vault-wide search — and shows you what it found
right under the field:

- **An exact match** shows the folder name with a "Tab to use" hint.
- **A close-but-not-exact match** (a likely typo) shows a suggested folder, with buttons to
  either use that folder or create a new one with exactly what you typed instead.
- **More than one plausible match** tells you so, and asks you to keep typing to narrow it down
  or explicitly create a new folder.
- **No match** shows nothing extra — just keep typing.

To commit a folder name and move on to the next level, press **Tab**, **Enter**, or **→** (right
arrow, when your cursor is at the end of the text) to accept a suggested folder, or type **/**
to commit whatever you've typed exactly as-is — as a new folder if nothing matching exists, or
as the matching existing folder if there's an exact one. Once committed, each folder appears as
a small chip; click a chip (or press Backspace on an empty field) to reopen and re-edit it,
which also discards anything you'd committed after it.

Whatever text is left in the field once you're done adding folders becomes the new note's
title.

**A couple of examples**, assuming your vault has folders `Learning`, `Learning/AI`, and
`Learning/AI/Machine Learning`:

- Type `Learning`, press Tab to accept it (it's an exact match) → type `AI`, press Tab → type
  `Local model notes` and click **Create and jump**. Result: a new note at
  `Learning/AI/Local model notes.md`.
- Type `Machien Learning` (a typo) under `Learning/AI` → Amnesiarch suggests "Machine Learning" as a
  likely match rather than guessing silently. Press Tab to accept the correction (the chip will
  show it was corrected from what you typed), or click the alternate button to create a new,
  separate folder spelled exactly as you typed it instead — Amnesiarch never auto-corrects a folder
  name you're deliberately creating.
- Type `Experiments` under `Learning/AI`, where no such folder exists yet, and press **/** →
  commits a *new* folder named exactly `Experiments` (shown with a "new" tag on its chip), ready
  for you to keep adding to or finish with a title.

## Privacy: what stays on your device

Amnesiarch runs entirely on your machine. Search, the AI matching behind it, and the folder-matching
logic all run locally — none of it calls out to an external server, and no note content or
captured text is ever sent anywhere.

The one exception is a one-time step: the first time you run Sort in a fresh install, Amnesiarch
downloads the small AI model it uses for semantic search from Hugging Face's model hub. That
download only fetches the model itself — it doesn't send it anything about your vault or your
notes. After that first download, the model is cached on your machine and Amnesiarch works fully
offline.

## Current limitations

- **Desktop only.** Amnesiarch doesn't currently work on Obsidian's mobile apps.
- **Matching thresholds are an early, untuned starting point.** The confidence and
  "how sure is sure enough" settings that decide between a confident match, an ambiguous
  choice, and a new-note suggestion haven't yet been calibrated against a large, real-world
  vault — only smaller test vaults so far. In a very large or unusually-structured vault, you
  may see Amnesiarch call something "confident" that you'd have called ambiguous, or vice versa, more
  often than ideal. This is expected to improve as it's used against more real vaults, but is
  worth knowing about now rather than being surprised by it.
