# AI Notes

An "AI Quick Capture" view for Obsidian that solves one specific problem: you have a fleeting thought ("Feature XYZ is also a good idea for project ABC"), and the note it belongs in has a filename that doesn't match how you'd say that out loud. Write it into a plain Quick Capture note, hit "Sort this note", and it proposes where the thought belongs — append to a confident match, pick from a few plausible notes, or create a new one — then jumps you to the result.

## Status

**v1 shipped and working**, since redesigned around an in-note routing UI (this replaced an earlier sidebar-chatbot pattern — see `src/view/QuickCaptureView.ts`). v2 (local LLM intent extraction, layered on top of the same deterministic search) is planned — see [`plans/`](plans/) for the design (gitignored, local-only).

## How it works

- **Indexing**: every note gets a local embedding (via `@huggingface/transformers`, running fully on-device — no API keys, nothing leaves your machine) plus metadata pulled straight from Obsidian's own caches: folder path, tags, aliases, `[[wikilinks]]`.
- **Search**: a hybrid score — semantic similarity (meaning) blended with lexical overlap against note titles/folders/tags (so "project ABC" counts for something even when the wording is vague).
- **Routing decision**: a confident match offers to append directly; a handful of close candidates shows a pick-one list; nothing confident enough offers to create a new note instead (with an editable, explicitly-confirmed title).
- **Preview, never silent**: the destination is always shown before anything is written, and what lands in a note is always your exact typed text — automation only ever decides *where* it goes, never rewrites *what* it says.

Full design rationale — what was tried and rejected (pure embeddings alone, LightRAG) and why — lives in the plan history.

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

## Project layout

```
main.ts                        # plugin entry: onload/onunload, wires everything together
src/
  embeddings/EmbeddingModel.ts # local WASM embedding model (lazy-loaded)
  index/                       # vault indexing: metadata extraction, JSON cache, incremental updates
  search/HybridSearch.ts       # semantic + lexical scoring
  append/AppendService.ts      # append-to-note
  create/CreateNoteService.ts  # create-new-note / title proposal
  view/QuickCaptureView.ts     # the Quick Capture UI (main-area view)
```

## License

MIT
