# Amnesiarch

**[amnesiarch.vercel.app](https://amnesiarch.vercel.app/)**

The intelligence layer for your notes. You have a fleeting thought ("Feature XYZ is also a good idea for project ABC"), and the note it belongs in has a filename that doesn't match how you'd say that out loud. Write it into a plain Quick Capture note, hit "Sort this note", and Amnesiarch proposes where the thought belongs — append to a confident match, pick from a few plausible notes, or create a new one — then jumps you to the result.

## How it works

Search and note routing run locally. Amnesiarch blends semantic similarity with your note titles, folders, and tags, so it holds up even when your wording is vague. The destination is always shown before anything is written, and what lands in a note is always your exact typed text — automation only ever decides *where* it goes, never rewrites *what* it says. When creating a new note, you can also type where it should live and what to call it in one field — existing folders are suggested and completed as you type (accept one with Tab or `/`), and typing a folder name that doesn't exist yet creates it inline.

## Privacy and network use

Amnesiarch does not use API keys, telemetry, or a hosted search service, and it never sends your note contents to a remote model. On first use, it downloads the embedding model and its required runtime files from Hugging Face; those files are then cached locally. The plugin stores a local index in its own plugin directory containing quantized embeddings and note metadata (including paths, titles, tags, links, and flattened frontmatter) so it can search without uploading your vault.

Amnesiarch currently supports Obsidian desktop only. For a manual or pre-release installation, see [Installing from source](./docs/install-from-source.md) for git clone and [BRAT](https://github.com/TfTHacker/obsidian42-brat) options.

## Local Sort statistics (optional, off by default)

Amnesiarch can locally record how Sort's suggestions get used — accepted, overridden, searched around, or dismissed — as evidence for tuning its matching thresholds later. This is entirely opt-in: enable it under Settings → Amnesiarch → Sort statistics → "Collect local Sort outcome statistics".

What's recorded: which decision state Sort showed (a confident match, a few candidates, no confident match), whether you accepted the top suggestion, picked something else, searched instead, created a new note, or dismissed the card — plus the matching/candidate scores, how long the decision took, and the thresholds active at the time.

What's never recorded: your note text, titles, paths, folder names, tags, search queries, or embeddings. Nothing leaves your device, and nothing recorded can identify which notes you actually use.

Everything lives in one local file in the plugin's own directory: `<vault>/.obsidian/plugins/amnesiarch/sort-stats.json`. Turning the setting off stops new events but keeps whatever was already recorded; use "Reset local Sort statistics" in the same section to delete it outright (this asks for confirmation first).

To review what's been recorded, run the bundled developer dashboard from a local clone of this repository (not from inside Obsidian itself):

```bash
npm run stats -- --vault "/absolute/path/to/your/vault"
```

This starts a small page at `http://127.0.0.1:4176`, bound to loopback only with no external requests, showing acceptance/override rates, decision timing, and the thresholds observed — plus a button to copy the aggregated numbers (counts and rates only, never vault content) for sharing as evidence elsewhere.

## Development

```bash
npm install
npm run dev      # esbuild watch, emits main.js
npm run typecheck
npm test         # Vitest unit and integration suite
npm run build    # production build
```

Load into a vault for testing by symlinking this directory into `.obsidian/plugins/amnesiarch/`:

```bash
ln -s /path/to/amnesiarch "<vault>/.obsidian/plugins/amnesiarch"
```

Then enable "Amnesiarch" under Settings → Community plugins in Obsidian.

## License

MIT
