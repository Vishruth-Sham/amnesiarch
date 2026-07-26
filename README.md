# AI Notes

A chat-style sidebar for Obsidian that solves one specific problem: you have a fleeting thought ("Feature XYZ is also a good idea for project ABC"), and the note it belongs in has a filename that doesn't match how you'd say that out loud. Instead of hunting through folders, type it into the panel — it finds the right note, shows you a preview, and appends it on your say-so.

## Status

**v1 shipped and working.** v2 (local LLM intent extraction, layered on top of the same deterministic search) is planned — see [`plans/`](plans/) for the design (gitignored, local-only).

## How it works

- **Indexing**: every note gets a local embedding (via `@huggingface/transformers`, running fully on-device — no API keys, nothing leaves your machine) plus metadata pulled straight from Obsidian's own caches: folder path, tags, aliases, `[[wikilinks]]`.
- **Search**: a hybrid score — semantic similarity (meaning) blended with lexical overlap against note titles/folders/tags (so "project ABC" counts for something even when the wording is vague).
- **`@tag`**: type `@` followed by a project/note name, press Enter, and it becomes a pinned target for that search — overrides the free-text matching when you already know where something belongs.
- **Preview, never silent**: below a confidence threshold, there's no one-click accept — only a copy-to-clipboard fallback, so it never appends to the wrong note without you seeing it first.

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
  append/AppendService.ts      # append-to-note / clipboard
  view/ChatView.ts             # the sidebar UI
```

## License

MIT
