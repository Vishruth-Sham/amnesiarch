export const VIEW_TYPE_AI_NOTES_CHAT = "ai-notes-chat-view";

export const MODEL_ID = "Xenova/all-MiniLM-L6-v2";
export const EMBEDDING_DIM = 384;

export const MIN_CONFIDENCE = 0.5;
/**
 * Minimum gap between the #1 and #2 result to call #1 "unambiguous" rather than merely
 * "above the confidence floor". Absolute cosine-score cutoffs shift with corpus size; a
 * margin is scale-invariant and asks the question that actually matters ("is there a clear
 * winner?") instead of "is the winner's raw score high?". This value is an initial guess --
 * it needs tuning against a real multi-thousand-note vault (see plans/v2-scale-first.md §6),
 * not just the ~500-note dev vault this was written against.
 */
export const MIN_MARGIN = 0.05;
export const STRUCTURAL_WEIGHT = 0.15;
export const TOP_K = 3;

export const INDEX_DEBOUNCE_MS = 2000;

export const CACHE_FILE_NAME = "notes-cache.json";
export const CACHE_VERSION = 2;
/** How long to wait after the last cache mutation before writing notes-cache.json to disk.
 *  Debounced (rather than one write per note) because save() serializes the whole file --
 *  see plans/v2-scale-first.md §2.2/§4 Phase 0. */
export const CACHE_SAVE_DEBOUNCE_MS = 10_000;
/** During a long initial index run, force an (undebounced) checkpoint write every N notes
 *  so quitting mid-build loses at most this many notes of progress, not the whole batch. */
export const SAVE_CHECKPOINT_INTERVAL = 200;

/** Target size of one embedded chunk, in characters. ~4 chars/token is a common approximation,
 *  so ~800 chars ≈ 200 tokens -- comfortably under all-MiniLM-L6-v2's 256-token max_seq_length,
 *  leaving margin before the tokenizer silently truncates (see plans/v2-scale-first.md §2.3). */
export const CHUNK_CHAR_BUDGET = 800;
/** ~15% overlap between adjacent chunks so a sentence spanning a chunk boundary still gets
 *  fully embedded in at least one chunk. */
export const CHUNK_OVERLAP_CHARS = 120;
/** Cap chunks per note so one very long note can't dominate index time/storage or bias search
 *  toward long notes just because they have more shots at matching. */
export const MAX_CHUNKS_PER_NOTE = 20;
