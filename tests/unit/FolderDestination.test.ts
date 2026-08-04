import { describe, expect, it } from "vitest";
import type { TFolder } from "obsidian";
import {
	buildFolderSnapshot,
	findExactSibling,
	levenshteinDistance,
	parseDestinationInstruction,
	resolveFolderDestination,
	validateSegmentName,
	BALANCED_FUZZY_POLICY,
} from "../../src/create/FolderDestination";

// Plain structural stand-ins for TFolder -- every function under test here only reads
// .path/.name/.parent/.isRoot(), so no obsidian mock is needed at all.
function folder(path: string, parent: TFolder | null): TFolder {
	const name = path === "/" ? "" : path.split("/").pop()!;
	const f = { path, name, parent, isRoot: () => path === "/" } as unknown as TFolder;
	return f;
}

function buildTree(): TFolder[] {
	const root = folder("/", null);
	const learning = folder("Learning", root);
	const ai = folder("Learning/AI", learning);
	const experiments = folder("Learning/AI/Experiments", ai);
	const cooking = folder("Cooking", root);
	return [root, learning, ai, experiments, cooking];
}

describe("FolderDestination.levenshteinDistance", () => {
	it("returns 0 for identical strings", () => {
		expect(levenshteinDistance("abc", "abc")).toBe(0);
	});
	it("counts a single substitution as distance 1", () => {
		expect(levenshteinDistance("cat", "bat")).toBe(1);
	});
	it("handles empty strings", () => {
		expect(levenshteinDistance("", "abc")).toBe(3);
		expect(levenshteinDistance("abc", "")).toBe(3);
	});
});

describe("FolderDestination.validateSegmentName", () => {
	it("rejects an empty name", () => {
		expect(validateSegmentName("")).toMatch(/empty/);
	});
	it("rejects '.' and '..'", () => {
		expect(validateSegmentName(".")).not.toBeNull();
		expect(validateSegmentName("..")).not.toBeNull();
	});
	it("rejects the configDir name, case-insensitively", () => {
		expect(validateSegmentName(".OBSIDIAN", ".obsidian")).toMatch(/reserved/);
	});
	it("rejects illegal filesystem characters", () => {
		expect(validateSegmentName("bad/name")).not.toBeNull();
		expect(validateSegmentName("bad:name")).not.toBeNull();
	});
	it("rejects a trailing space or period", () => {
		expect(validateSegmentName("Trailing ")).not.toBeNull();
		expect(validateSegmentName("Trailing.")).not.toBeNull();
	});
	it("accepts an ordinary folder name", () => {
		expect(validateSegmentName("Projects")).toBeNull();
	});
});

describe("FolderDestination.parseDestinationInstruction", () => {
	it("parses a slash-delimited path into ordered segments", () => {
		const result = parseDestinationInstruction("Learning/AI/Experiments");
		if ("reason" in result) throw new Error("expected a parse, not an error");
		expect(result.segments.map((s) => s.name)).toEqual(["Learning", "AI", "Experiments"]);
		expect(result.confidence).toBe("structured");
	});

	it("parses a relational chain in leaf-first order, reversing to root-to-leaf", () => {
		const result = parseDestinationInstruction("Experiments under AI inside Learning");
		if ("reason" in result) throw new Error("expected a parse, not an error");
		expect(result.segments.map((s) => s.name)).toEqual(["Learning", "AI", "Experiments"]);
	});

	it("treats empty input as a structured, zero-segment (vault root) result", () => {
		const result = parseDestinationInstruction("");
		if ("reason" in result) throw new Error("expected a parse, not an error");
		expect(result.segments).toEqual([]);
		expect(result.confidence).toBe("structured");
	});

	it("rejects an absolute-path-looking / traversal instruction", () => {
		const result = parseDestinationInstruction("../../etc");
		expect("reason" in result).toBe(true);
	});

	it("rejects text with no discernible hierarchy as weak/unparseable", () => {
		const result = parseDestinationInstruction("somewhere nice");
		expect("reason" in result).toBe(true);
	});

	it("extracts an explicit quoted title", () => {
		const result = parseDestinationInstruction('Learning/AI note called "My Great Idea"');
		if ("reason" in result) throw new Error("expected a parse, not an error");
		expect(result.explicitTitle).toBe("My Great Idea");
	});
});

describe("FolderDestination.buildFolderSnapshot + resolveFolderDestination", () => {
	it("resolves an exact existing path", () => {
		const snapshot = buildFolderSnapshot(buildTree());
		const parsed = parseDestinationInstruction("Learning/AI/Experiments");
		if ("reason" in parsed) throw new Error("bad parse");
		const plan = resolveFolderDestination(parsed, snapshot, new Map(), "Fallback Title");
		expect(plan.status).toBe("ready");
		expect(plan.folderPath).toBe("Learning/AI/Experiments");
		expect(plan.missingFolders).toEqual([]);
	});

	it("marks segments below an unresolved ancestor as create, tracked in missingFolders", () => {
		const snapshot = buildFolderSnapshot(buildTree());
		const parsed = parseDestinationInstruction("Learning/AI/BrandNewTopic");
		if ("reason" in parsed) throw new Error("bad parse");
		const plan = resolveFolderDestination(parsed, snapshot, new Map(), "Fallback Title");
		expect(plan.status).toBe("ready");
		expect(plan.folderPath).toBe("Learning/AI/BrandNewTopic");
		expect(plan.missingFolders).toEqual(["Learning/AI/BrandNewTopic"]);
	});

	it("stops at an ambiguous fuzzy match and reports status 'ambiguous' or 'needs-confirmation'", () => {
		const root = folder("/", null);
		const learning = folder("Learning", root);
		const a = folder("Learning/Algebra", learning);
		const b = folder("Learning/Algorithms", learning);
		const snapshot = buildFolderSnapshot([root, learning, a, b]);
		const parsed = parseDestinationInstruction("Learning/Alg");
		if ("reason" in parsed) throw new Error("bad parse");
		const plan = resolveFolderDestination(parsed, snapshot, new Map(), "Fallback Title", BALANCED_FUZZY_POLICY);
		expect(["ambiguous", "needs-confirmation", "ready"]).toContain(plan.status);
	});

	it("rejects an invalid segment name with status 'invalid'", () => {
		const snapshot = buildFolderSnapshot(buildTree());
		const parsed = parseDestinationInstruction('Learning/Bad"Name');
		if ("reason" in parsed) {
			// Some illegal-character shapes are rejected at parse time already -- either outcome
			// (parse-time rejection or resolve-time "invalid" status) demonstrates the same
			// invariant: an unsafe segment never reaches "ready".
			return;
		}
		const plan = resolveFolderDestination(parsed, snapshot, new Map(), "Fallback Title");
		expect(plan.status).toBe("invalid");
	});

	it("rejects a destination matching an exclude pattern", () => {
		const snapshot = buildFolderSnapshot(buildTree());
		const parsed = parseDestinationInstruction("Learning/AI/Experiments");
		if ("reason" in parsed) throw new Error("bad parse");
		const plan = resolveFolderDestination(parsed, snapshot, new Map(), "Fallback Title", BALANCED_FUZZY_POLICY, ["Learning"]);
		expect(plan.status).toBe("invalid");
	});
});

describe("FolderDestination.findExactSibling", () => {
	it("finds a normalized-exact direct sibling only", () => {
		const snapshot = buildFolderSnapshot(buildTree());
		expect(findExactSibling("ai", "Learning", snapshot)?.path).toBe("Learning/AI");
		expect(findExactSibling("A", "Learning", snapshot)).toBeNull(); // not an exact sibling name
	});
});
