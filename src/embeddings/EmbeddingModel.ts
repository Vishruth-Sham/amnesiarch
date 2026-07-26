import type { FeatureExtractionPipeline } from "@huggingface/transformers";
import { MODEL_ID } from "../constants";

/**
 * Obsidian's desktop renderer has Node integration enabled, which trips two separate
 * environment-detection checks inside the embedding stack, both keyed off real `process`
 * fields that are only meant to distinguish "real Node.js" from "browser":
 *
 * 1. transformers.js itself checks `process.release.name === "node"` to decide between its
 *    native `onnxruntime-node` backend and its WASM `onnxruntime-web` backend. The native
 *    addon can't be resolved through Obsidian's plugin loader (no working module-resolution
 *    path into this plugin's own `node_modules`), so that backend is a dead end here.
 * 2. Having picked the WASM backend, onnxruntime-web's own glue script (fetched from the HF
 *    CDN at runtime) separately checks `process.versions.node` to decide whether to probe for
 *    multi-threading support, and does that probe via `await import("worker_threads")` -- an
 *    ESM dynamic import of a Node builtin, which Chromium's module loader (used for dynamic
 *    `import()` even in a Node-integrated Electron renderer) cannot resolve, unlike `require()`.
 *
 * Both fields report real Node.js values here (Electron sets them), but a plain assignment to
 * either throws ("read only property"). `Object.defineProperty` can still redefine a
 * non-writable-but-configurable property, so we shadow both for the duration of the whole load
 * (import + pipeline construction, since the WASM glue fetch happens lazily inside that, not
 * during the top-level import), then restore the originals.
 */
function forceBrowserLikeProcess(): () => void {
	const proc = process as unknown as { release?: { name?: string }; versions?: { node?: string } };
	const restorers: Array<() => void> = [];

	const patch = (obj: Record<string, unknown> | undefined, key: string, value: unknown) => {
		if (!obj) return;
		const original = obj[key];
		try {
			Object.defineProperty(obj, key, { value, configurable: true, writable: true });
			restorers.push(() => {
				try {
					Object.defineProperty(obj, key, { value: original, configurable: true, writable: true });
				} catch {
					// best-effort restore
				}
			});
		} catch (e) {
			console.warn(`AI Notes: could not override process.${key}; embedding may fail`, e);
		}
	};

	patch(proc.release as Record<string, unknown> | undefined, "name", "obsidian-renderer");
	patch(proc.versions as Record<string, unknown> | undefined, "node", undefined);

	return () => restorers.forEach((r) => r());
}

let extractorPromise: Promise<FeatureExtractionPipeline> | null = null;

function loadExtractor(): Promise<FeatureExtractionPipeline> {
	if (!extractorPromise) {
		extractorPromise = (async () => {
			const restore = forceBrowserLikeProcess();
			try {
				const { pipeline, env } = await import("@huggingface/transformers");
				// Never look for locally-bundled model weights; always fetch from the HF hub
				// (cached locally after the first run).
				env.allowLocalModels = false;
				if (env.backends?.onnx?.wasm) {
					env.backends.onnx.wasm.numThreads = 1;
				}
				return await pipeline<"feature-extraction">("feature-extraction", MODEL_ID, { dtype: "q8" });
			} finally {
				restore();
			}
		})();
	}
	return extractorPromise;
}

export async function embedText(text: string): Promise<number[]> {
	const extractor = await loadExtractor();
	const output = await extractor(text, { pooling: "mean", normalize: true });
	return Array.from(output.data as Float32Array);
}
