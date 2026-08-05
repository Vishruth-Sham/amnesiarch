# Amnesiarch

**[amnesiarch.vercel.app](https://amnesiarch.vercel.app/)**

The intelligence layer for your notes. You have a fleeting thought ("Feature XYZ is also a good idea for project ABC"), and the note it belongs in has a filename that doesn't match how you'd say that out loud. Write it into a plain Quick Capture note, hit "Sort this note", and Amnesiarch proposes where the thought belongs — append to a confident match, pick from a few plausible notes, or create a new one — then jumps you to the result.

## How it works

Search and note routing run locally. Amnesiarch blends semantic similarity with your note titles, folders, and tags, so it holds up even when your wording is vague. The destination is always shown before anything is written, and what lands in a note is always your exact typed text — automation only ever decides *where* it goes, never rewrites *what* it says. When creating a new note, you can also type where it should live and what to call it in one field — existing folders are suggested and completed as you type (accept one with Tab or `/`), and typing a folder name that doesn't exist yet creates it inline.

## Privacy and network use

Amnesiarch does not use API keys, telemetry, or a hosted search service, and it never sends your note contents to a remote model. On first use, it downloads the embedding model and its required runtime files from Hugging Face; those files are then cached locally. The plugin stores a local index in its own plugin directory containing quantized embeddings and note metadata (including paths, titles, tags, links, and flattened frontmatter) so it can search without uploading your vault.

Amnesiarch currently supports Obsidian desktop only. For a manual or pre-release installation, see [Installing from source](./docs/install-from-source.md) for git clone and [BRAT](https://github.com/TfTHacker/obsidian42-brat) options.

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
