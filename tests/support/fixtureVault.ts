/**
 * Deterministic, seeded generator for a "dense" synthetic Obsidian vault: many notes spread
 * across multiple nested folder hierarchies, a real wikilink graph, and several topic clusters
 * with genuinely topical (hand-authored, not scraped/lorem-ipsum) vocabulary -- so search-ranking
 * integration tests can make meaningful assertions instead of tautological ones.
 *
 * Fully offline and reproducible: the same seed always produces byte-identical output, so this
 * is "checked in" as generator code rather than as several hundred static .md files -- reviewed
 * as a logic diff, trivially extendable (bump a count, add a cluster).
 *
 * Every fact a test might want to assert against (link pairs, edge-case note paths, exact schema-
 * key threshold counts, etc.) is returned in `meta` rather than left for tests to re-derive by
 * re-parsing generated content.
 */

// -------------------------------------------------------------------------------------------
// Seeded PRNG (mulberry32) -- deterministic across machines/runs, not cryptographic.
// -------------------------------------------------------------------------------------------

function makeRand(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function pick<T>(rand: () => number, arr: readonly T[]): T {
	return arr[Math.floor(rand() * arr.length)];
}

function randInt(rand: () => number, min: number, max: number): number {
	return min + Math.floor(rand() * (max - min + 1));
}

// -------------------------------------------------------------------------------------------
// Topic clusters -- hand-authored short paragraphs per topic, deliberately using distinct,
// non-overlapping vocabulary across clusters so the fake embedder's bag-of-words averaging
// produces measurably different (and internally similar) document vectors per cluster.
// -------------------------------------------------------------------------------------------

interface ClusterNoteSpec {
	title: string;
	sections: { heading: string; paragraphs: string[] }[];
}

interface ClusterSpec {
	name: string;
	folder: string;
	tag: string;
	notes: ClusterNoteSpec[];
}

const CLUSTERS: ClusterSpec[] = [
	{
		name: "sourdough",
		folder: "Resources/Cooking/Sourdough",
		tag: "sourdough",
		notes: [
			{
				title: "Starter Maintenance",
				sections: [
					{
						heading: "Daily feeding",
						paragraphs: [
							"A sourdough starter needs a consistent feeding ratio of flour, water, and existing starter to stay active. Discard most of the starter before each feeding so the culture doesn't outgrow its jar, and keep the hydration steady so the yeast and lactic acid bacteria stay balanced.",
						],
					},
					{
						heading: "Signs of a healthy starter",
						paragraphs: [
							"A healthy starter doubles within four to six hours of feeding, smells pleasantly tangy rather than sharply acidic, and shows an even network of bubbles through the jar. A layer of dark liquid, sometimes called hooch, means the starter is hungry and due for a feeding.",
						],
					},
				],
			},
			{
				title: "Autolyse Technique",
				sections: [
					{
						heading: "Why autolyse matters",
						paragraphs: [
							"Autolyse is a rest period where flour and water are mixed before the starter and salt are added, giving the flour time to fully hydrate and the gluten network time to begin developing on its own. See [[Bulk Fermentation Timing|timing guide]] for how this interacts with the fermentation schedule.",
						],
					},
				],
			},
			{
				title: "Bulk Fermentation Timing",
				sections: [
					{
						heading: "Reading the dough, not the clock",
						paragraphs: [
							"Bulk fermentation is finished when the dough has grown by roughly fifty percent, feels airy and jiggly, and holds a slight dome when the container is tilted. Ambient temperature has a much bigger effect on timing than the recipe's suggested hours, so a warm kitchen can cut bulk fermentation nearly in half.",
						],
					},
				],
			},
			{
				title: "Shaping and Scoring",
				sections: [
					{
						heading: "Building surface tension",
						paragraphs: [
							"Shaping builds surface tension across the dough's skin so the loaf holds its form and rises upward instead of spreading outward in the oven. A bench scraper dragged in a circular motion against the counter is usually more effective than hand pressure alone.",
						],
					},
					{
						heading: "Scoring for oven spring",
						paragraphs: [
							"A confident, single scoring cut at a shallow angle gives steam a controlled place to escape, which is what produces a dramatic ear on the finished sourdough loaf. See [[Nonexistent Sourdough Note]] for more on decorative scoring patterns.",
						],
					},
				],
			},
			{
				title: "Troubleshooting Dense Crumb",
				sections: [
					{
						heading: "Common causes",
						paragraphs: [
							"Dense, gummy crumb in a sourdough loaf usually traces back to an underactive starter, underproofed dough, or a bulk fermentation that was cut short. Weak gluten development from skipping folds during bulk fermentation is another frequent culprit.",
						],
						// Long paragraph, deliberately over the 800-char chunk budget, to force
						// Chunker.ts's paragraph-packing to split within this section.
					},
					{
						heading: "A longer diagnostic pass",
						paragraphs: [
							"Before assuming the starter is the problem, run a simple float test: drop a small spoonful of starter into a glass of room-temperature water right at peak activity and confirm it floats, since a starter that sinks is not yet ready to leaven a full loaf and will produce a dense, under-risen crumb no matter how carefully the rest of the process is followed. Next, check the dough's temperature through bulk fermentation, since a dough sitting below roughly seventy degrees Fahrenheit will ferment far more slowly than a recipe's stated timeline assumes, and pulling it into the fridge or the oven too early effectively locks in an underproofed structure. Also reconsider hydration: a very stiff, low-hydration dough resists the kind of open, airy crumb most bakers are chasing, while a properly hydrated dough that has been folded and shaped with care will trap gas more evenly throughout the loaf. Finally, look at the bake itself, since insufficient steam in the first several minutes lets the crust set before the loaf has finished its final oven spring, which flattens what would otherwise have been an open, well-aerated interior; a preheated Dutch oven or a generous steam injection at the start of the bake usually resolves this last piece of the puzzle on its own.",
						],
					},
				],
			},
			{
				title: "Sourdough Discard Recipes",
				sections: [
					{
						heading: "Using discard instead of wasting it",
						paragraphs: [
							"Discard starter still carries flavor and some leavening power, so it works well folded into pancake batter, crackers, or flatbread where a big rise isn't the goal. Keeping a running jar of discard in the fridge also means always having a head start on the next bake.",
						],
					},
				],
			},
		],
	},
	{
		name: "typescript-generics",
		folder: "Resources/Programming/TypeScript",
		tag: "typescript",
		notes: [
			{
				title: "Generic Constraints",
				sections: [
					{
						heading: "Bounding a type parameter",
						paragraphs: [
							"A generic constraint narrows a type parameter to only the shapes that satisfy a given interface, using the extends keyword inside the angle brackets. This lets a generic function safely access properties the compiler can otherwise not assume exist on an unconstrained type parameter. See [[Resources/Cooking/Sourdough/Starter Maintenance]] for an unrelated cross-reference used only to exercise explicit-path links in tests.",
						],
					},
				],
			},
			{
				title: "Conditional Types",
				sections: [
					{
						heading: "Distributive conditional types",
						paragraphs: [
							"A conditional type of the form T extends U ? X : Y resolves differently depending on whether T is itself a union, distributing the conditional across each member of the union unless that behavior is explicitly suppressed by wrapping the checked type in a tuple.",
						],
					},
				],
			},
			{
				title: "Mapped Types",
				sections: [
					{
						heading: "Transforming keys and values",
						paragraphs: [
							"A mapped type iterates over the keys of an existing type to produce a new type, optionally remapping keys with an as clause and adjusting modifiers like readonly or optional along the way. This is the mechanism behind built-in utility types such as Partial and Readonly.",
						],
					},
				],
			},
			{
				title: "Utility Type Patterns",
				sections: [
					{
						heading: "Composing utility types",
						paragraphs: [
							"Utility types like Pick, Omit, and Record are themselves built from mapped and conditional types, and they compose well together to derive new shapes from an existing interface without duplicating field declarations across the codebase.",
						],
					},
				],
			},
			{
				title: "Variance and Generics",
				sections: [
					{
						heading: "Covariance versus contravariance",
						paragraphs: [
							"A generic type is covariant in a position if a subtype relationship in the type argument produces the same subtype relationship in the generic type, which is typically true for read-only positions like function return types and false for write positions like function parameters.",
						],
					},
				],
			},
			{
				title: "Generic Function Overloads",
				sections: [
					{
						heading: "When overloads beat a single generic signature",
						paragraphs: [
							"Overload signatures are useful when a function's return type depends on a discrete set of input shapes that a single generic signature can't express cleanly, letting each overload pin down a specific, non-generic relationship between its parameters and its return type.",
						],
					},
				],
			},
		],
	},
	{
		name: "marathon-training",
		folder: "Areas/Health/Running",
		tag: "running",
		notes: [
			{
				title: "Base Building Phase",
				sections: [
					{
						heading: "Why aerobic base comes first",
						paragraphs: [
							"Base building emphasizes easy-paced mileage that develops aerobic capacity, capillary density, and mitochondrial efficiency before any faster, higher-intensity marathon-specific workouts are introduced. Runners who skip this phase tend to plateau earlier once tempo and interval work begins.",
						],
					},
				],
			},
			{
				title: "Tempo Run Workouts",
				sections: [
					{
						heading: "Comfortably hard pace",
						paragraphs: [
							"A tempo run is run at a comfortably hard, sustainable pace, typically close to lactate threshold, and trains the body to clear lactate more efficiently at race pace over a marathon distance.",
						],
					},
				],
			},
			{
				title: "Taper Week Plan",
				sections: [
					{
						heading: "Reducing volume, keeping intensity",
						paragraphs: [
							"Tapering cuts weekly mileage significantly in the final two to three weeks before race day while preserving some shorter, race-pace efforts, letting the body fully recover and supercompensate without losing race sharpness. See [[Base Building Phase]] and [[Tempo Run Workouts]] for the phases that precede taper.",
						],
					},
				],
			},
			{
				title: "Long Run Fueling",
				sections: [
					{
						heading: "Carbohydrate intake during long runs",
						paragraphs: [
							"Long runs beyond ninety minutes benefit from practicing race-day fueling, since the gut itself needs training to tolerate carbohydrate intake at pace, and waiting until race day to test a fueling plan is a common and avoidable mistake.",
						],
					},
				],
			},
			{
				title: "Injury Prevention Routine",
				sections: [
					{
						heading: "Strength work for durability",
						paragraphs: [
							"A short strength routine focused on the hips, glutes, and calves reduces common marathon-training injuries like IT band pain and shin splints by correcting the muscular imbalances that high weekly mileage tends to expose.",
						],
					},
				],
			},
			{
				title: "Race Day Checklist",
				sections: [
					{
						heading: "Morning of the race",
						paragraphs: [
							"A race-day checklist covering gear, fueling, and pacing strategy removes decision fatigue on race morning, letting a runner focus entirely on executing the pacing plan built up over the whole training block.",
						],
					},
				],
			},
		],
	},
	{
		name: "japanese-grammar",
		folder: "Areas/Language/Japanese",
		tag: "japanese",
		notes: [
			{
				title: "Particle wa vs ga",
				sections: [
					{
						heading: "Topic versus subject marking",
						paragraphs: [
							"The particle wa marks a sentence's topic, framing what the rest of the sentence is about, while ga marks the grammatical subject and often introduces new or contrasted information. Choosing between them is one of the most persistent challenges for learners of Japanese grammar.",
						],
					},
				],
			},
			{
				title: "Te Form Conjugation",
				sections: [
					{
						heading: "Building the te form",
						paragraphs: [
							"The te form is a non-finite verb form used to link clauses, form requests, and build the progressive aspect, and its conjugation pattern depends on the verb's group and its final syllable before the ending is dropped.",
						],
					},
				],
			},
			{
				title: "Conditional Forms",
				sections: [
					{
						heading: "Four ways to say if",
						paragraphs: [
							"Japanese grammar distinguishes several conditional forms, including tara, ba, to, and nara, each carrying a different nuance around certainty, sequence, and general truth that doesn't map cleanly onto a single English if-clause.",
						],
					},
				],
			},
			{
				title: "Keigo Politeness Levels",
				sections: [
					{
						heading: "Respectful versus humble language",
						paragraphs: [
							"Keigo layers honorific language for the listener's actions with humble language for the speaker's own actions, and choosing the correct register depends heavily on social hierarchy and context rather than grammar alone.",
						],
					},
				],
			},
			{
				title: "Counter Words",
				sections: [
					{
						heading: "Counting different kinds of objects",
						paragraphs: [
							"Japanese uses different counter words depending on the shape and category of the object being counted, so flat objects, long cylindrical objects, and small animals each take a distinct counting suffix.",
						],
					},
				],
			},
			{
				title: "Relative Clauses",
				sections: [
					{
						heading: "Clauses that modify nouns",
						paragraphs: [
							"Japanese builds relative clauses by placing the modifying clause directly before the noun it describes, with no relative pronoun equivalent to English's who or that, which reverses the word order English speakers usually expect.",
						],
					},
				],
			},
		],
	},
	{
		name: "composting",
		folder: "Projects/Garden/Compost",
		tag: "composting",
		notes: [
			{
				title: "Carbon Nitrogen Ratio",
				sections: [
					{
						heading: "Balancing browns and greens",
						paragraphs: [
							"A healthy compost pile balances carbon-rich browns like dried leaves and cardboard against nitrogen-rich greens like vegetable scraps and grass clippings, roughly in a thirty-to-one ratio by weight, to keep the microbial community active without the pile turning slimy or overly dry.",
						],
					},
				],
			},
			{
				title: "Turning Schedule",
				sections: [
					{
						heading: "Aerating the pile",
						paragraphs: [
							"Turning the compost pile every one to two weeks introduces oxygen that aerobic microbes need to break down material efficiently, and it also redistributes heat so material at the edges gets a turn through the hotter center of the pile.",
						],
					},
				],
			},
			{
				title: "Troubleshooting Odor",
				sections: [
					{
						heading: "A smelly pile means too little oxygen",
						paragraphs: [
							"A compost pile that smells sour or like ammonia is usually too wet, too compacted, or too heavy on nitrogen-rich greens, all of which push the pile into anaerobic decomposition; turning it and adding dry carbon-rich material usually resolves the smell within a few days.",
						],
					},
				],
			},
			{
				title: "Vermicomposting Setup",
				sections: [
					{
						heading: "Composting with worms indoors",
						paragraphs: [
							"Vermicomposting uses red wiggler worms in a shallow, ventilated bin to break down food scraps indoors, producing worm castings that are a notably rich soil amendment compared to a standard outdoor compost pile.",
						],
					},
				],
			},
			{
				title: "Finished Compost Uses",
				sections: [
					{
						heading: "Knowing when compost is ready",
						paragraphs: [
							"Finished compost is dark, crumbly, and smells like fresh earth rather than any of its original ingredients, and at that point it can be worked into garden beds or used as a top dressing without risk of burning young plants.",
						],
					},
				],
			},
			{
				title: "Winter Composting Tips",
				sections: [
					{
						heading: "Keeping the pile active in the cold",
						paragraphs: [
							"A compost pile slows dramatically in cold weather as microbial activity drops off, so insulating the pile with a thick layer of straw and building it larger than usual before winter helps it retain enough heat to keep working through the season.",
						],
					},
				],
			},
		],
	},
];

// -------------------------------------------------------------------------------------------
// Generic vocabulary pools for filler notes -- deliberately disjoint from the cluster vocabulary
// above so filler notes don't accidentally skew cluster-ranking assertions.
// -------------------------------------------------------------------------------------------

const FOLDER_NAME_POOL = [
	"ClientA",
	"ClientB",
	"ClientC",
	"Meetings",
	"Drafts",
	"2023",
	"2024",
	"2025",
	"Q1",
	"Q2",
	"Q3",
	"Q4",
	"Ideas",
	"Reference",
	"Old",
	"Team",
	"Personal",
	"Work",
	"Misc",
	"Planning",
	"Reviews",
	"Logs",
	"Assets",
	"Docs",
	"Reports",
];

const GENERIC_TITLE_WORDS = [
	"Weekly Sync",
	"Budget Review",
	"Onboarding Notes",
	"Kickoff Summary",
	"Status Update",
	"Retro Notes",
	"Backlog Grooming",
	"Roadmap Draft",
	"Vendor Call",
	"Design Review",
	"Interview Debrief",
	"Planning Session",
	"Follow Up",
	"Checklist",
	"Reference Sheet",
	"Action Items",
	"Meeting Minutes",
	"Proposal Draft",
	"Feedback Log",
	"Expense Report",
];

const GENERIC_SENTENCES = [
	"The team agreed to revisit the timeline once the vendor confirms availability next week.",
	"Budget approval is still pending sign-off from finance before the purchase order goes out.",
	"Action items were assigned and a follow-up sync was scheduled for the following Thursday.",
	"The draft proposal needs another pass on the pricing section before it goes to the client.",
	"Onboarding for the new hire is on track, with equipment shipped and accounts provisioned.",
	"The retro surfaced a recurring blocker around handoffs between the design and engineering teams.",
	"Feedback from the last review round has been incorporated into the latest revision.",
	"The checklist covers everything needed before the release goes out to the wider team.",
	"Minutes from the meeting were shared with everyone who couldn't attend in person.",
	"The quarterly roadmap draft is open for comments until the end of the week.",
];

const GENERIC_TAGS_SHARED = ["work", "planning", "review", "team"];
const CUSTOM_KEY_POOL = ["status", "priority", "project", "created"];
const STATUS_VALUES = ["draft", "active", "done"];
const PRIORITY_VALUES = ["low", "medium", "high"];
const PROJECT_VALUES = ["Atlas", "Meridian", "Northwind", "Beacon"];

// -------------------------------------------------------------------------------------------
// Rendering helpers
// -------------------------------------------------------------------------------------------

function renderFrontmatter(fm: Record<string, unknown>): string {
	const lines: string[] = ["---"];
	for (const [key, value] of Object.entries(fm)) {
		if (Array.isArray(value)) {
			lines.push(`${key}: [${value.map((v) => JSON.stringify(v)).join(", ")}]`);
		} else if (typeof value === "object" && value !== null) {
			lines.push(`${key}:`);
			for (const [k2, v2] of Object.entries(value as Record<string, unknown>)) {
				lines.push(`  ${k2}: ${JSON.stringify(v2)}`);
			}
		} else {
			lines.push(`${key}: ${JSON.stringify(value)}`);
		}
	}
	lines.push("---", "");
	return lines.join("\n");
}

function renderClusterNote(spec: ClusterNoteSpec, tag: string): string {
	const parts: string[] = [];
	parts.push(renderFrontmatter({ tags: [tag] }));
	parts.push(`# ${spec.title}`, "");
	for (const section of spec.sections) {
		parts.push(`## ${section.heading}`, "");
		for (const p of section.paragraphs) parts.push(p, "");
	}
	return parts.join("\n");
}

// -------------------------------------------------------------------------------------------
// Public types
// -------------------------------------------------------------------------------------------

export interface TopicClusterMeta {
	name: string;
	folder: string;
	tag: string;
	notePaths: string[];
}

export interface FixtureMeta {
	totalNoteCount: number;
	allFolders: string[];
	clusters: TopicClusterMeta[];
	// Deliberate link facts, for exact backlink/outgoing-link assertions.
	chainLinks: { from: string; to: string }[]; // simple wikilink, e.g. [[Title]]
	aliasLink: { from: string; to: string; alias: string };
	explicitPathLink: { from: string; to: string };
	brokenLink: { from: string; targetText: string };
	// Edge-case notes.
	emptyNotePath: string;
	noFrontmatterNotePath: string;
	deepNotePath: string;
	deepNoteFolderChain: string[];
	duplicateBasenamePaths: [string, string];
	duplicateBasename: string;
	duplicateBasenameSameFolderLink: { from: string; expectedTarget: string };
	duplicateBasenameTieBreakLink: { from: string; expectedTarget: string };
	mixedFrontmatterNotePath: string;
	longNotePath: string; // forces multi-chunk packing
	hugeNotePath: string; // forces MAX_CHUNKS_PER_NOTE downsampling
	excludedFolder: string;
	excludedFolderNotePaths: string[];
	// Exact schema-key threshold facts (VaultProfiler.SCHEMA_KEY_MIN_FRACTION = 0.05).
	schemaKeyAtThreshold: { key: string; notePaths: string[] };
	schemaKeyBelowThreshold: { key: string; notePaths: string[] };
}

export interface FixtureVault {
	files: Map<string, string>;
	meta: FixtureMeta;
}

// -------------------------------------------------------------------------------------------
// Generator
// -------------------------------------------------------------------------------------------

const TOP_LEVEL_AREAS = ["Projects", "Areas", "Resources", "Archive", "Inbox"];
const TEMPLATES_FOLDER = "Templates";
const TOTAL_NOTE_TARGET = 300;

export function buildFixtureVault(seed = 42): FixtureVault {
	const rand = makeRand(seed);
	const files = new Map<string, string>();
	const allFolders = new Set<string>();

	// --- Cluster notes (deliberate, hand-authored, exact paths) ---
	const clusters: TopicClusterMeta[] = [];
	const chainLinks: { from: string; to: string }[] = [];
	let longNotePath = "";
	let hugeNotePath = "";

	for (const cluster of CLUSTERS) {
		allFolders.add(cluster.folder);
		const notePaths: string[] = [];
		for (const note of cluster.notes) {
			const path = `${cluster.folder}/${note.title}.md`;
			notePaths.push(path);
		}
		for (let i = 0; i < cluster.notes.length; i++) {
			const note = cluster.notes[i];
			const path = notePaths[i];
			let content = renderClusterNote(note, cluster.tag);
			if (i > 0) {
				// Chain link: each note (after the first) links back to the previous one, giving
				// a predictable, assertable backlink pair per cluster.
				content += `\n## Related\n\n[[${cluster.notes[i - 1].title}]]\n`;
				chainLinks.push({ from: path, to: notePaths[i - 1] });
			}
			files.set(path, content);
			const totalLen = content.length;
			if (totalLen > 800 && !longNotePath) longNotePath = path;
		}
		clusters.push({ name: cluster.name, folder: cluster.folder, tag: cluster.tag, notePaths });
	}

	// A note deliberately long enough to exceed MAX_CHUNKS_PER_NOTE (20 chunks * ~800 chars).
	{
		const hugeFolder = "Resources/Cooking/Sourdough";
		const hugePath = `${hugeFolder}/Complete Sourdough Reference.md`;
		const paragraph =
			"This is a long, repeated reference paragraph about sourdough hydration, fermentation, shaping, and scoring, deliberately padded so this single note produces far more chunks than the plugin's per-note cap allows, exercising the even-stride downsampling path in Chunker.ts rather than a simple truncation. ";
		const bigBody = Array.from({ length: 60 }, () => paragraph).join("\n\n");
		files.set(hugePath, `${renderFrontmatter({ tags: ["sourdough", "reference"] })}\n# Complete Sourdough Reference\n\n${bigBody}\n`);
		hugeNotePath = hugePath;
	}

	// Alias-form link: [[Title|alias]]
	const aliasFrom = `${CLUSTERS[0].folder}/${CLUSTERS[0].notes[1].title}.md`; // Autolyse Technique
	const aliasTo = `${CLUSTERS[0].folder}/${CLUSTERS[0].notes[2].title}.md`; // Bulk Fermentation Timing
	const aliasLink = { from: aliasFrom, to: aliasTo, alias: "timing guide" };

	// Explicit-path cross-folder link (already embedded in "Generic Constraints" note body above).
	const explicitPathLink = {
		from: `${CLUSTERS[1].folder}/${CLUSTERS[1].notes[0].title}.md`, // Generic Constraints
		to: `${CLUSTERS[0].folder}/${CLUSTERS[0].notes[0].title}.md`, // Starter Maintenance
	};

	// Broken link (already embedded in "Shaping and Scoring" note body above).
	const brokenLink = {
		from: `${CLUSTERS[0].folder}/${CLUSTERS[0].notes[3].title}.md`, // Shaping and Scoring
		targetText: "Nonexistent Sourdough Note",
	};

	// --- Templates (excluded-folder fixture) ---
	const excludedFolderNotePaths: string[] = [];
	for (const title of ["Daily Note Template", "Weekly Review Template", "Meeting Notes Template"]) {
		const path = `${TEMPLATES_FOLDER}/${title}.md`;
		files.set(path, `# ${title}\n\nFill in the sections below.\n\n## Notes\n\n`);
		excludedFolderNotePaths.push(path);
		allFolders.add(TEMPLATES_FOLDER);
	}

	// --- Edge-case notes ---
	const emptyNotePath = "Inbox/Empty Capture.md";
	files.set(emptyNotePath, "");

	const noFrontmatterNotePath = "Areas/Misc/Plain Note.md";
	files.set(noFrontmatterNotePath, "# Plain Note\n\nJust a note with no frontmatter at all.\n");
	allFolders.add("Areas/Misc");

	const deepNoteFolderChain = ["Projects", "ClientA", "2024", "Q3", "Reports"];
	const deepNotePath = `${deepNoteFolderChain.join("/")}/Deep Note.md`;
	files.set(deepNotePath, "# Deep Note\n\nA note nested five folders deep, for folder-chain assertions.\n");
	for (let i = 1; i <= deepNoteFolderChain.length; i++) allFolders.add(deepNoteFolderChain.slice(0, i).join("/"));

	const duplicateBasename = "Overview";
	const dupPathA = "Resources/Programming/Overview.md";
	const dupPathB = "Areas/Health/Overview.md";
	files.set(dupPathA, `# ${duplicateBasename}\n\nProgramming resources overview.\n`);
	files.set(dupPathB, `# ${duplicateBasename}\n\nHealth area overview.\n`);
	allFolders.add("Resources/Programming");
	allFolders.add("Areas/Health");

	const mixedFrontmatterNotePath = "Areas/Misc/Mixed Frontmatter.md";
	files.set(
		mixedFrontmatterNotePath,
		`${renderFrontmatter({
			tags: ["misc"],
			collaborators: ["Alex", "Sam"],
			details: { owner: "Alex", reviewed: true },
		})}\n# Mixed Frontmatter\n\nExercises both an array-valued and an object-valued frontmatter key.\n`,
	);

	// Duplicate-basename wikilink resolution: two notes are both named "Overview" (dupPathA in
	// Resources/Programming, dupPathB in Areas/Health -- see above). One link source sits in the
	// same folder as dupPathA (should resolve there, same-folder-first); another sits in neither
	// folder (should tie-break to the shortest path, dupPathB).
	const duplicateBasenameSameFolderLinkPath = "Resources/Programming/Guide.md";
	files.set(duplicateBasenameSameFolderLinkPath, "# Guide\n\nSee [[Overview]] for background.\n");
	const duplicateBasenameTieBreakLinkPath = "Inbox/Overview Pointer.md";
	files.set(duplicateBasenameTieBreakLinkPath, "# Overview Pointer\n\nSee [[Overview]] for background.\n");

	// --- Filler notes across a generated folder tree under each top-level area ---
	const clusterAndFixedCount = files.size;
	const fillerTarget = Math.max(0, TOTAL_NOTE_TARGET - clusterAndFixedCount);
	const fillerPerArea = Math.ceil(fillerTarget / TOP_LEVEL_AREAS.length);

	const fillerNotePaths: string[] = [];

	for (const area of TOP_LEVEL_AREAS) {
		allFolders.add(area);
		// Build a folder tree 2-4 levels deep (including the area itself) under this area.
		const areaFolders: string[] = [area];
		const l2Count = randInt(rand, 3, 6);
		const l2Folders: string[] = [];
		for (let i = 0; i < l2Count; i++) {
			const name = `${pick(rand, FOLDER_NAME_POOL)}${i}`;
			const path = `${area}/${name}`;
			l2Folders.push(path);
			areaFolders.push(path);
		}
		for (const l2 of l2Folders) {
			if (rand() < 0.6) {
				const l3Count = randInt(rand, 1, 3);
				for (let j = 0; j < l3Count; j++) {
					const name = `${pick(rand, FOLDER_NAME_POOL)}${j}`;
					const path = `${l2}/${name}`;
					areaFolders.push(path);
					if (rand() < 0.4) {
						const l4 = `${path}/${pick(rand, FOLDER_NAME_POOL)}`;
						areaFolders.push(l4);
					}
				}
			}
		}
		for (const f of areaFolders) allFolders.add(f);

		for (let n = 0; n < fillerPerArea && fillerNotePaths.length < fillerTarget; n++) {
			const folder = pick(rand, areaFolders);
			const titleBase = pick(rand, GENERIC_TITLE_WORDS);
			const title = `${titleBase} ${randInt(rand, 1, 999)}`;
			const path = `${folder}/${title}.md`;
			if (files.has(path)) continue; // extremely rare collision; just skip

			const hasFrontmatter = rand() < 0.7;
			const parts: string[] = [];
			if (hasFrontmatter) {
				const fm: Record<string, unknown> = {};
				const tags: string[] = [];
				if (rand() < 0.8) tags.push(pick(rand, GENERIC_TAGS_SHARED));
				if (rand() < 0.15) tags.push(`one-off-${randInt(rand, 1000, 9999)}`); // idiosyncratic tag
				if (tags.length > 0) fm.tags = tags;
				if (rand() < 0.2) fm.aliases = [`${titleBase} alt`];
				const keyCount = randInt(rand, 1, 3);
				for (let k = 0; k < keyCount; k++) {
					const key = pick(rand, CUSTOM_KEY_POOL);
					if (key === "status") fm.status = pick(rand, STATUS_VALUES);
					else if (key === "priority") fm.priority = pick(rand, PRIORITY_VALUES);
					else if (key === "project") fm.project = pick(rand, PROJECT_VALUES);
					else if (key === "created") fm.created = `2024-0${randInt(rand, 1, 9)}-1${randInt(rand, 0, 5)}`;
				}
				parts.push(renderFrontmatter(fm));
			}
			parts.push(`# ${title}`, "");
			const headingCount = rand() < 0.4 ? randInt(rand, 1, 2) : 0;
			if (headingCount > 0) {
				for (let h = 0; h < headingCount; h++) {
					parts.push(`## Section ${h + 1}`, "");
					parts.push(pick(rand, GENERIC_SENTENCES), "");
				}
			} else {
				const sentCount = randInt(rand, 1, 3);
				for (let s = 0; s < sentCount; s++) parts.push(pick(rand, GENERIC_SENTENCES), "");
			}
			if (rand() < 0.1) {
				const inlineTag = pick(rand, GENERIC_TAGS_SHARED);
				parts.push(`#${inlineTag}`, "");
			}
			// Occasional link to another already-created filler note, for link-density variety
			// (not asserted on exactly -- only the deliberate cluster/edge-case links above are).
			if (fillerNotePaths.length > 5 && rand() < 0.15) {
				const targetPath = pick(rand, fillerNotePaths);
				const targetBasename = targetPath.slice(targetPath.lastIndexOf("/") + 1, -3);
				parts.push(`See also [[${targetBasename}]].`, "");
			}

			files.set(path, parts.join("\n"));
			fillerNotePaths.push(path);
		}
	}

	// --- Exact schema-key threshold facts, assigned deterministically over the filler notes so
	// the boundary (VaultProfiler.SCHEMA_KEY_MIN_FRACTION = 0.05) is hit precisely regardless of
	// any other randomization above. ---
	const totalNoteCount = files.size;
	const atThresholdCount = Math.ceil(totalNoteCount * 0.05); // >= 5% -> included
	const belowThresholdCount = Math.max(1, Math.floor(totalNoteCount * 0.05) - 1); // < 5% -> excluded

	const schemaKeyAtThresholdPaths = fillerNotePaths.slice(0, atThresholdCount);
	const schemaKeyBelowThresholdPaths = fillerNotePaths.slice(atThresholdCount, atThresholdCount + belowThresholdCount);

	const appendFrontmatterKey = (path: string, key: string, value: string) => {
		const content = files.get(path)!;
		if (content.startsWith("---\n")) {
			const end = content.indexOf("\n---", 4);
			const insertAt = end === -1 ? 4 : end;
			files.set(path, `${content.slice(0, insertAt)}\n${key}: ${JSON.stringify(value)}${content.slice(insertAt)}`);
		} else {
			files.set(path, `${renderFrontmatter({ [key]: value })}\n${content}`);
		}
	};

	for (const path of schemaKeyAtThresholdPaths) appendFrontmatterKey(path, "reviewCycle", "quarterly");
	for (const path of schemaKeyBelowThresholdPaths) appendFrontmatterKey(path, "legacyFlag", "true");

	const meta: FixtureMeta = {
		totalNoteCount,
		allFolders: Array.from(allFolders).sort(),
		clusters,
		chainLinks,
		aliasLink,
		explicitPathLink,
		brokenLink,
		emptyNotePath,
		noFrontmatterNotePath,
		deepNotePath,
		deepNoteFolderChain,
		duplicateBasenamePaths: [dupPathA, dupPathB],
		duplicateBasename,
		duplicateBasenameSameFolderLink: { from: duplicateBasenameSameFolderLinkPath, expectedTarget: dupPathA },
		duplicateBasenameTieBreakLink: { from: duplicateBasenameTieBreakLinkPath, expectedTarget: dupPathB },
		mixedFrontmatterNotePath,
		longNotePath,
		hugeNotePath,
		excludedFolder: TEMPLATES_FOLDER,
		excludedFolderNotePaths,
		schemaKeyAtThreshold: { key: "reviewCycle", notePaths: schemaKeyAtThresholdPaths },
		schemaKeyBelowThreshold: { key: "legacyFlag", notePaths: schemaKeyBelowThresholdPaths },
	};

	return { files, meta };
}
