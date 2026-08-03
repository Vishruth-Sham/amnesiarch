/**
 * Minimal headless reimplementation of the slice of the `obsidian` API that this plugin's
 * indexing/search/create/append modules actually import. The real `obsidian` npm package is
 * types-only (no runtime JS at all -- the real implementation is injected by the Obsidian
 * desktop app itself), so this module is aliased in place of "obsidian" for every test (see
 * vitest.config.ts's resolve.alias). Not a general-purpose Obsidian API mock -- only what's
 * needed to drive VaultIndexer/MetadataExtractor/NoteCache/CreateNoteService/AppendService.
 */
import { parse as parseYaml } from "yaml";

// ---------------------------------------------------------------------------------------------
// Files/folders
// ---------------------------------------------------------------------------------------------

export abstract class TAbstractFile {
	vault!: Vault;
	path!: string;
	name!: string;
	parent!: TFolder | null;
}

export interface FileStats {
	ctime: number;
	mtime: number;
	size: number;
}

export class TFile extends TAbstractFile {
	stat!: FileStats;
	basename!: string;
	extension!: string;
}

export class TFolder extends TAbstractFile {
	children: TAbstractFile[] = [];
	isRoot(): boolean {
		return this.path === "/";
	}
}

// ---------------------------------------------------------------------------------------------
// normalizePath (mirrors Obsidian's own behavior closely enough for test fixtures)
// ---------------------------------------------------------------------------------------------

export function normalizePath(path: string): string {
	const unified = path.replace(/\\/g, "/").replace(/\/+/g, "/");
	const trimmed = unified.replace(/^\/+/, "").replace(/\/+$/, "");
	return trimmed === "" ? "/" : trimmed;
}

// ---------------------------------------------------------------------------------------------
// Events (real emitter, not a no-op -- main.ts's registerEvent wiring depends on this firing)
// ---------------------------------------------------------------------------------------------

export interface EventRef {
	name: string;
	callback: (...args: unknown[]) => unknown;
}

export class Events {
	private listeners = new Map<string, Set<(...args: unknown[]) => unknown>>();

	on(name: string, callback: (...args: unknown[]) => unknown): EventRef {
		if (!this.listeners.has(name)) this.listeners.set(name, new Set());
		this.listeners.get(name)!.add(callback);
		return { name, callback };
	}

	off(name: string, callback: (...args: unknown[]) => unknown): void {
		this.listeners.get(name)?.delete(callback);
	}

	trigger(name: string, ...args: unknown[]): void {
		for (const cb of this.listeners.get(name) ?? []) cb(...args);
	}
}

// ---------------------------------------------------------------------------------------------
// Metadata cache types (subset)
// ---------------------------------------------------------------------------------------------

export interface Loc {
	line: number;
	col: number;
	offset: number;
}

export interface Pos {
	start: Loc;
	end: Loc;
}

export interface CacheItem {
	position: Pos;
}

export interface HeadingCache extends CacheItem {
	heading: string;
	level: number;
}

export interface TagCache extends CacheItem {
	tag: string;
}

export interface FrontMatterCache {
	[key: string]: unknown;
}

export interface CachedMetadata {
	tags?: TagCache[];
	headings?: HeadingCache[];
	frontmatter?: FrontMatterCache;
}

export function getAllTags(cache: CachedMetadata): string[] | null {
	const set = new Set<string>();
	for (const t of cache.tags ?? []) set.add(t.tag.startsWith("#") ? t.tag : `#${t.tag}`);
	const fmTags = cache.frontmatter?.tags ?? cache.frontmatter?.tag;
	if (Array.isArray(fmTags)) {
		for (const t of fmTags) set.add(String(t).startsWith("#") ? String(t) : `#${String(t)}`);
	} else if (typeof fmTags === "string" && fmTags.length > 0) {
		set.add(fmTags.startsWith("#") ? fmTags : `#${fmTags}`);
	}
	return set.size > 0 ? Array.from(set) : null;
}

// ---------------------------------------------------------------------------------------------
// Notice (no-op)
// ---------------------------------------------------------------------------------------------

export class Notice {
	constructor(_message: string, _duration?: number) {}
}

// ---------------------------------------------------------------------------------------------
// Note content parsing (frontmatter / headings / inline tags / wikilinks) -- shared by
// MetadataCache below. Deliberately only covers what the fixture vault + real plugin code need,
// not general CommonMark.
// ---------------------------------------------------------------------------------------------

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const HEADING_RE = /^(#{1,6})\s+(.+?)\s*$/;
const WIKILINK_RE = /\[\[([^\]|#]+)(#[^\]|]*)?(\|[^\]]*)?\]\]/g;
const FENCE_RE = /^```/;

interface ParsedNote {
	frontmatter: FrontMatterCache | undefined;
	headings: HeadingCache[];
	tags: TagCache[];
	linkTargets: string[]; // raw link text before resolution, e.g. "Folder/Note" or "Note"
}

function stripCodeFences(lines: string[]): boolean[] {
	// Returns a per-line "inside a fenced code block" mask, so tag/heading scanning can skip them.
	const mask: boolean[] = new Array(lines.length).fill(false);
	let inFence = false;
	for (let i = 0; i < lines.length; i++) {
		if (FENCE_RE.test(lines[i])) {
			inFence = !inFence;
			mask[i] = true; // the fence line itself is not content to scan
			continue;
		}
		mask[i] = inFence;
	}
	return mask;
}

export function parseNoteContent(content: string): ParsedNote {
	let body = content;
	let frontmatter: FrontMatterCache | undefined;
	const fmMatch = FRONTMATTER_RE.exec(content);
	let bodyStartLine = 0;
	if (fmMatch) {
		try {
			const parsed = parseYaml(fmMatch[1]) as unknown;
			frontmatter = (parsed && typeof parsed === "object" ? (parsed as FrontMatterCache) : {}) ?? {};
		} catch {
			frontmatter = {};
		}
		// Obsidian injects a synthetic `position` key onto frontmatter itself.
		const fmLineCount = fmMatch[0].split("\n").length - 1;
		frontmatter.position = {
			start: { line: 0, col: 0, offset: 0 },
			end: { line: fmLineCount - 1, col: 3, offset: fmMatch[0].length },
		};
		body = content.slice(fmMatch[0].length);
		bodyStartLine = fmLineCount;
	}

	const lines = body.split("\n");
	const codeMask = stripCodeFences(lines);

	const headings: HeadingCache[] = [];
	const tags: TagCache[] = [];

	for (let i = 0; i < lines.length; i++) {
		if (codeMask[i]) continue;
		const line = lines[i];
		const absLine = i + bodyStartLine;

		const hMatch = HEADING_RE.exec(line);
		if (hMatch) {
			headings.push({
				heading: hMatch[2],
				level: hMatch[1].length,
				position: {
					start: { line: absLine, col: 0, offset: 0 },
					end: { line: absLine, col: line.length, offset: 0 },
				},
			});
			continue;
		}

		// Inline #tags: strip inline code spans first so `#include` inside `` `#include` `` etc
		// doesn't false-positive.
		const withoutInlineCode = line.replace(/`[^`]*`/g, "");
		const tagRe = /(^|\s)#([A-Za-z0-9_/-]+)/g;
		let m: RegExpExecArray | null;
		while ((m = tagRe.exec(withoutInlineCode))) {
			tags.push({
				tag: `#${m[2]}`,
				position: {
					start: { line: absLine, col: m.index, offset: 0 },
					end: { line: absLine, col: m.index + m[0].length, offset: 0 },
				},
			});
		}
	}

	const linkTargets: string[] = [];
	let lm: RegExpExecArray | null;
	WIKILINK_RE.lastIndex = 0;
	while ((lm = WIKILINK_RE.exec(body))) {
		linkTargets.push(lm[1].trim());
	}

	return { frontmatter, headings, tags, linkTargets };
}

// ---------------------------------------------------------------------------------------------
// DataAdapter (shares the same in-memory store as regular vault files, like real Obsidian)
// ---------------------------------------------------------------------------------------------

export interface DataAdapter {
	read(path: string): Promise<string>;
	write(path: string, data: string): Promise<void>;
	exists(path: string): Promise<boolean>;
}

// ---------------------------------------------------------------------------------------------
// Vault
// ---------------------------------------------------------------------------------------------

interface FileRecord {
	content: string;
	ctime: number;
	mtime: number;
}

export class Vault extends Events {
	configDir = ".obsidian";

	private files = new Map<string, FileRecord>();
	private folders = new Set<string>(["/"]);
	private fileObjs = new Map<string, TFile>();
	private folderObjs = new Map<string, TFolder>();

	adapter: DataAdapter = {
		read: (path: string) => this.readRaw(path),
		write: (path: string, data: string) => {
			this.writeRaw(path, data);
			return Promise.resolve();
		},
		exists: (path: string) => Promise.resolve(this.files.has(normalizePath(path)) || this.folders.has(normalizePath(path))),
	};

	constructor() {
		super();
		this.folderObjs.set("/", this.makeFolder("/"));
	}

	private makeFolder(path: string): TFolder {
		const f = new TFolder();
		f.path = path;
		f.name = path === "/" ? "" : path.split("/").pop()!;
		f.vault = this;
		f.parent = null;
		return f;
	}

	private ensureFolderChain(path: string): TFolder {
		if (path === "/") return this.folderObjs.get("/")!;
		if (this.folderObjs.has(path)) return this.folderObjs.get(path)!;
		const segments = path.split("/");
		let built = "";
		let parent = this.folderObjs.get("/")!;
		for (const seg of segments) {
			built = built ? `${built}/${seg}` : seg;
			if (!this.folderObjs.has(built)) {
				const folder = this.makeFolder(built);
				folder.parent = parent;
				this.folderObjs.set(built, folder);
				this.folders.add(built);
				parent.children.push(folder);
			}
			parent = this.folderObjs.get(built)!;
		}
		return parent;
	}

	private makeFile(path: string, record: FileRecord): TFile {
		const parentPath = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "/";
		const folder = this.ensureFolderChain(parentPath);
		const f = new TFile();
		f.path = path;
		const base = path.split("/").pop()!;
		const dot = base.lastIndexOf(".");
		f.basename = dot > 0 ? base.slice(0, dot) : base;
		f.extension = dot > 0 ? base.slice(dot + 1) : "";
		f.name = base;
		f.vault = this;
		f.parent = folder;
		f.stat = { ctime: record.ctime, mtime: record.mtime, size: record.content.length };
		return f;
	}

	private readRaw(path: string): Promise<string> {
		const norm = normalizePath(path);
		const rec = this.files.get(norm);
		if (!rec) return Promise.reject(new Error(`Amnesiarch mock: no such file ${norm}`));
		return Promise.resolve(rec.content);
	}

	private writeRaw(path: string, data: string, opts?: { preserveCtime?: boolean }): TFile {
		const norm = normalizePath(path);
		const now = Date.now();
		const existing = this.files.get(norm);
		const rec: FileRecord = {
			content: data,
			ctime: opts?.preserveCtime && existing ? existing.ctime : (existing?.ctime ?? now),
			mtime: now,
		};
		this.files.set(norm, rec);
		const file = this.makeFile(norm, rec);
		this.fileObjs.set(norm, file);
		return file;
	}

	/** Test-only helper: seed a file directly with explicit ctime/mtime (bypasses "now"), so
	 *  incremental-indexing tests can construct exact before/after mtime scenarios. */
	seedFile(path: string, content: string, ctime: number, mtime: number): TFile {
		const norm = normalizePath(path);
		this.files.set(norm, { content, ctime, mtime });
		const file = this.makeFile(norm, this.files.get(norm)!);
		this.fileObjs.set(norm, file);
		return file;
	}

	seedFolder(path: string): TFolder {
		return this.ensureFolderChain(normalizePath(path));
	}

	getMarkdownFiles(): TFile[] {
		return Array.from(this.files.keys())
			.filter((p) => p.endsWith(".md"))
			.map((p) => this.fileObjs.get(p)!);
	}

	getAbstractFileByPath(path: string): TAbstractFile | null {
		const norm = normalizePath(path);
		if (this.fileObjs.has(norm)) return this.fileObjs.get(norm)!;
		if (this.folderObjs.has(norm)) return this.folderObjs.get(norm)!;
		return null;
	}

	async cachedRead(file: TFile): Promise<string> {
		return this.readRaw(file.path);
	}

	/** Synchronous internal accessor for MetadataCache's own re-parse pass -- not part of the
	 *  real Obsidian API surface. */
	peekContent(path: string): string | undefined {
		return this.files.get(normalizePath(path))?.content;
	}

	async read(file: TFile): Promise<string> {
		return this.readRaw(file.path);
	}

	async create(path: string, content: string): Promise<TFile> {
		const norm = normalizePath(path);
		if (this.files.has(norm) || this.folders.has(norm)) {
			throw new Error(`Amnesiarch mock: ${norm} already exists`);
		}
		const file = this.writeRaw(norm, content);
		this.trigger("create", file);
		this.recomputeLinksHook?.();
		return file;
	}

	async createFolder(path: string): Promise<TFolder> {
		const norm = normalizePath(path);
		if (this.folders.has(norm)) throw new Error(`Amnesiarch mock: folder ${norm} already exists`);
		return this.ensureFolderChain(norm);
	}

	async process(file: TFile, fn: (data: string) => string): Promise<string> {
		const current = await this.readRaw(file.path);
		const next = fn(current);
		this.writeRaw(file.path, next, { preserveCtime: true });
		this.trigger("modify", this.fileObjs.get(normalizePath(file.path))!);
		this.recomputeLinksHook?.();
		return next;
	}

	/** Test-only helpers for simulating vault mutations end to end. */
	async modifyFile(path: string, content: string, mtime = Date.now()): Promise<TFile> {
		const norm = normalizePath(path);
		const existing = this.files.get(norm);
		this.files.set(norm, { content, ctime: existing?.ctime ?? mtime, mtime });
		const file = this.makeFile(norm, this.files.get(norm)!);
		this.fileObjs.set(norm, file);
		this.trigger("modify", file);
		this.recomputeLinksHook?.();
		return file;
	}

	async deleteFile(path: string): Promise<void> {
		const norm = normalizePath(path);
		const file = this.fileObjs.get(norm);
		this.files.delete(norm);
		this.fileObjs.delete(norm);
		if (file) this.trigger("delete", file);
		this.recomputeLinksHook?.();
	}

	async renameFile(oldPath: string, newPath: string): Promise<TFile> {
		const oldNorm = normalizePath(oldPath);
		const newNorm = normalizePath(newPath);
		const rec = this.files.get(oldNorm);
		if (!rec) throw new Error(`Amnesiarch mock: no such file ${oldNorm}`);
		this.files.delete(oldNorm);
		this.fileObjs.delete(oldNorm);
		this.files.set(newNorm, rec);
		const file = this.makeFile(newNorm, rec);
		this.fileObjs.set(newNorm, file);
		this.trigger("rename", file, oldNorm);
		this.recomputeLinksHook?.();
		return file;
	}

	/** Wired by MetadataCache so link resolution stays in sync with vault mutations. */
	recomputeLinksHook: (() => void) | null = null;

	/** Test-only: bulk-seed many files at once (used by the fixture vault loader). */
	seedFiles(entries: Map<string, string>, baseTime = Date.now()): void {
		let i = 0;
		for (const [path, content] of entries) {
			// Stagger mtimes deterministically so "most-recently-modified-first" ordering tests
			// have a stable, distinguishable order across the whole fixture.
			this.seedFile(path, content, baseTime - entries.size * 1000 + i * 1000, baseTime - entries.size * 1000 + i * 1000);
			i++;
		}
	}
}

// ---------------------------------------------------------------------------------------------
// MetadataCache
// ---------------------------------------------------------------------------------------------

export class MetadataCache extends Events {
	resolvedLinks: Record<string, Record<string, number>> = {};
	unresolvedLinks: Record<string, Record<string, number>> = {};

	private cacheByPath = new Map<string, CachedMetadata>();

	constructor(private vault: Vault) {
		super();
		vault.recomputeLinksHook = () => this.recomputeAll();
	}

	getFileCache(file: TFile): CachedMetadata | null {
		return this.cacheByPath.get(normalizePath(file.path)) ?? null;
	}

	getCache(path: string): CachedMetadata | null {
		return this.cacheByPath.get(normalizePath(path)) ?? null;
	}

	/** Rebuild every note's parsed metadata + the vault-wide resolvedLinks graph from scratch.
	 *  Called after every vault mutation (see Vault.recomputeLinksHook) -- a full pass rather than
	 *  incremental maintenance, which is cheap at fixture-vault scale and avoids an entire class
	 *  of incremental-cache-invalidation bugs in the mock itself. */
	recomputeAll(): void {
		const files = this.vault.getMarkdownFiles();
		this.cacheByPath.clear();

		const byBasename = new Map<string, TFile[]>();
		for (const f of files) {
			const key = f.basename.toLowerCase();
			if (!byBasename.has(key)) byBasename.set(key, []);
			byBasename.get(key)!.push(f);
		}

		const parsedByPath = new Map<string, ReturnType<typeof parseNoteContent>>();
		for (const f of files) {
			const content = this.vault.peekContent(f.path) ?? "";
			const parsed = parseNoteContent(content);
			parsedByPath.set(f.path, parsed);
			this.cacheByPath.set(f.path, {
				frontmatter: parsed.frontmatter,
				headings: parsed.headings,
				tags: parsed.tags,
			});
		}

		const resolveTarget = (sourcePath: string, rawTarget: string): TFile | null => {
			const target = rawTarget.trim();
			if (target.length === 0) return null;
			if (target.includes("/")) {
				const withExt = target.endsWith(".md") ? target : `${target}.md`;
				const direct = files.find((f) => f.path === normalizePath(withExt));
				if (direct) return direct;
			}
			const candidates = byBasename.get(target.toLowerCase()) ?? [];
			if (candidates.length === 0) return null;
			if (candidates.length === 1) return candidates[0];
			const sourceFolder = sourcePath.includes("/") ? sourcePath.slice(0, sourcePath.lastIndexOf("/")) : "";
			const sameFolder = candidates.find((c) => (c.path.includes("/") ? c.path.slice(0, c.path.lastIndexOf("/")) : "") === sourceFolder);
			if (sameFolder) return sameFolder;
			return [...candidates].sort((a, b) => a.path.length - b.path.length || a.path.localeCompare(b.path))[0];
		};

		const resolved: Record<string, Record<string, number>> = {};
		for (const f of files) {
			const parsed = parsedByPath.get(f.path)!;
			const targets: Record<string, number> = {};
			for (const raw of parsed.linkTargets) {
				const resolvedFile = resolveTarget(f.path, raw);
				if (resolvedFile) targets[resolvedFile.path] = (targets[resolvedFile.path] ?? 0) + 1;
			}
			resolved[f.path] = targets;
		}
		this.resolvedLinks = resolved;
	}
}

// ---------------------------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------------------------

export class App {
	vault: Vault;
	metadataCache: MetadataCache;
	workspace: Events = new Events();

	constructor() {
		this.vault = new Vault();
		this.metadataCache = new MetadataCache(this.vault);
	}
}
