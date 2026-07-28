# CLAUDE.md — working notes for this repo

Context for whoever (human or Claude) picks this project up next. The README is for users; this is for whoever's editing the code.

## Current state

v1 is built and verified working end-to-end in the real dev vault (indexing, search, `@tag` targeting, accept/append, decline/copy). The chat panel UI was redesigned once already (quiet-utilitarian visual language, see `styles.css` header comment).

v2 planning was reframed around scale (large/heterogeneous vaults as the design center, not an edge case) rather than jumping straight to LLM intent extraction — see `plans/v2-scale-first.md`, which supersedes the older `plans/v2-llm-intent-extraction.md` (that file's Ollama HTTP-mechanics and date-parsing design still apply to the new plan's deferred Phase 5). **Phases 0–4 of that plan are implemented** (`tsc`/`esbuild` clean; not yet run/clicked through in a real vault — see "No automated tests exist" below):
- **Phase 0** — cache format v2: int8-quantized embeddings (`src/embeddings/Quantize.ts`), debounced writes with periodic checkpoint flushes (`NoteCache.scheduleSave()`/`flush()`).
- **Phase 1** — chunked embeddings (`src/index/Chunker.ts`) fixing a real v1 bug: notes were embedded from a 4000-char slice while MiniLM's `max_seq_length` is 256 tokens (~1000 chars), so ~3/4 of every note was silently invisible to search. `NoteEntry.embedding: number[]` is gone; `NoteEntry.chunks: NoteChunk[]` (score = max over chunks) replaces it.
- **Phase 2** — vault profiling (`src/index/VaultProfiler.ts`) + adaptive structural weights (`src/search/AdaptiveWeights.ts`, `src/search/ProfileCache.ts`) so `structuralScore`'s title/folder/tag balance adapts to the vault (e.g. zettelkasten UID titles vs PARA-style folders) instead of one global constant. Frontmatter properties are now captured (`MetadataExtractor.ts`) instead of discarded. Debug command: "AI Notes: Show vault profile".
- **Phase 3** — progressive indexing: most-recently-modified-first ordering, periodic save checkpoints so a killed initial index doesn't lose the whole batch, and folder-prefix exclude patterns (Settings tab — first one this plugin has — plus "AI Notes: Rebuild index" command).
- **Phase 4** — margin-based confidence (`MIN_MARGIN` in `constants.ts`) instead of an absolute score cutoff alone, a genuine "ambiguous — pick one" UI state, and "no confident match" now offers creating a new note (`src/create/CreateNoteService.ts`) rather than dead-ending.
- **Phase 5** (grounded query IR + Ollama/in-process LLM backend) is intentionally not started — "we'll see" per the user.

Cache format bumped to v2; old caches are detected and fully re-indexed (no note-by-note migration — see `NoteCache.load()`), so the first load after upgrading will re-embed the whole vault.

## Do not "clean up" `EmbeddingModel.ts` — read this first

`src/embeddings/EmbeddingModel.ts` contains code that looks like a hack and is one, deliberately, load-bearing. **Do not remove `forceBrowserLikeProcess()` or the `process.release.name`/`process.versions.node` overrides without understanding why they're there first.**

The short version: `@huggingface/transformers` picks its ONNX backend by checking `process.release.name === "node"`. Obsidian's desktop renderer has Node integration enabled, so that check is true, but:
- The native `onnxruntime-node` backend it would then try to use **cannot be resolved** — Obsidian's plugin loader doesn't give `require()` a working module-resolution path into this plugin's own `node_modules` (confirmed by direct testing: `Cannot find module 'onnxruntime-node'`, resolution originates from `electron/js2c/renderer_init`, not this plugin's directory).
- Falling back to the WASM backend, onnxruntime-web's own loader *separately* checks `process.versions.node` to decide whether to probe for multi-threading via `await import("worker_threads")` — a dynamic ESM import of a Node builtin, which Chromium's module loader cannot resolve even with Node integration on (confirmed: `TypeError: Failed to resolve module specifier 'worker_threads'`).

Fix: both checks get shadowed (via `Object.defineProperty`, since plain assignment throws — these are read-only properties in Electron) for the duration of loading the model, forcing it down the self-contained WASM code path. This took several rounds of actual runtime debugging in the live Obsidian console to nail down — don't re-derive it from scratch, and don't "simplify" it back to a plain `pipeline(...)` call.

Related: `esbuild.config.mjs` deliberately does **not** set `platform: "node"`. That was tried (to make the *native* onnxruntime-node path work instead of fighting it) and made things worse — it just moved the failure to "module doesn't resolve at all" instead of "resolves to a broken object." Default (browser) platform is correct here; it's what makes esbuild pick transformers.js's self-contained web/WASM dist in the first place.

## Other things worth knowing

- **No automated tests exist.** Verification is manual: build, reload the plugin in a real Obsidian vault, check the console and UI by hand. There's no way to drive Obsidian's GUI from this environment — if you're an agent working on this repo, say so explicitly rather than claiming something is "verified" when only `tsc`/`esbuild` passed.
- **Append-text invariant**: whatever gets written into a note is always the user's exact original text. No feature (the `@tag` flow, and now the planned LLM intent extraction) is allowed to rewrite it — automation may only affect *which note* gets targeted and *how it's found*, never *what gets appended*. This was an explicit, repeated design decision — don't relax it without asking.
- **Scoring signals are boosts, never gates** (except the final `MIN_CONFIDENCE` cutoff itself). `structuralScore`, and the planned date/graph boosts, all add on top of the semantic score — none of them can silently exclude the actually-correct note. Keep new signals additive.
- **Local-only, by repeated deliberate choice**: embeddings run on-device, no external API calls in v1. LightRAG was investigated and rejected specifically because it puts an LLM in the indexing loop and needs a Python sidecar (see plan history). v2's Ollama integration is a deliberate, scoped exception — LLM only at query time, only for extracting search hints, always optional with a silent fallback to v1 behavior if Ollama isn't running.
- **Dev vault**: `/Users/vishruth/Documents/Obsidian Content`, plugin symlinked at `.obsidian/plugins/ai-notes` → this repo.
- **Local model context for v2**: user has Ollama 0.30.11 running locally with `qwen3:4b-thinking` and `qwen2.5-coder:3b` already pulled.

## Plans

Claude Code's plan-mode files live at `~/.claude/plans/` (harness-managed, outside this repo). Copies get saved into `plans/` here for local reference and are gitignored — ask before assuming a plan in that folder is current; check its content/date against what's actually built.
