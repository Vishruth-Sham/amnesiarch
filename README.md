# Amnesiarch

The intelligence layer for your notes. You have a fleeting thought ("Feature XYZ is also a good idea for project ABC"), and the note it belongs in has a filename that doesn't match how you'd say that out loud. Write it into a plain Quick Capture note, hit "Sort this note", and Amnesiarch proposes where the thought belongs — append to a confident match, pick from a few plausible notes, or create a new one — then jumps you to the result.

## How it works

Everything runs locally — no API keys, nothing leaves your machine. Search blends semantic similarity with your note titles, folders, and tags, so it holds up even when your wording is vague. The destination is always shown before anything is written, and what lands in a note is always your exact typed text — automation only ever decides *where* it goes, never rewrites *what* it says. When creating a new note, you can also type where it should live and what to call it in one field — existing folders are suggested and completed as you type (accept one with Tab or `/`), and typing a folder name that doesn't exist yet creates it inline.

Not yet in Obsidian's Community Plugins directory — see
[Installing from source](./docs/install-from-source.md) for how to install now via git
clone or [BRAT](https://github.com/TfTHacker/obsidian42-brat).

## Development

```bash
npm install
npm run dev      # esbuild watch, emits main.js
npm run build    # production build
```

Load into a vault for testing by symlinking this directory into `.obsidian/plugins/amnesiarch/`:

```bash
ln -s /path/to/amnesiarch "<vault>/.obsidian/plugins/amnesiarch"
```

Then enable "Amnesiarch" under Settings → Community plugins in Obsidian.

## License

MIT
