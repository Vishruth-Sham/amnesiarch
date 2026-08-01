# AI Notes

An "AI Quick Capture" view for Obsidian that solves one specific problem: you have a fleeting thought ("Feature XYZ is also a good idea for project ABC"), and the note it belongs in has a filename that doesn't match how you'd say that out loud. Write it into a plain Quick Capture note, hit "Sort this note", and it proposes where the thought belongs — append to a confident match, pick from a few plausible notes, or create a new one — then jumps you to the result.

## How it works

Everything runs locally — no API keys, nothing leaves your machine. Search blends semantic similarity with your note titles, folders, and tags, so it holds up even when your wording is vague. The destination is always shown before anything is written, and what lands in a note is always your exact typed text — automation only ever decides *where* it goes, never rewrites *what* it says. When creating a new note, you can also describe where it should live in plain language (`New folder Experiments under AI inside Learning`) and it'll build that structure for you, asking before it guesses.

## Development

```bash
npm install
npm run dev      # esbuild watch, emits main.js
npm run build    # production build
```

Load into a vault for testing by symlinking this directory into `.obsidian/plugins/ai-notes/`:

```bash
ln -s /path/to/AI-notes "<vault>/.obsidian/plugins/ai-notes"
```

Then enable "AI Notes" under Settings → Community plugins in Obsidian.

## License

MIT
