import type { HeadingCache } from "obsidian";
import { CHUNK_CHAR_BUDGET, CHUNK_OVERLAP_CHARS, MAX_CHUNKS_PER_NOTE } from "../constants";

export interface RawChunk {
	headingPath: string; // e.g. "Project ABC > Meeting notes", "" if no headings apply
	text: string;
}

interface Section {
	headingPath: string;
	text: string;
}

/**
 * Split note content into sections along heading boundaries, building an "H1 > H2" style path
 * per section from the heading stack (so a level-3 heading nested under two ancestors carries
 * both in its path). Content before the first heading -- or the whole note, if it has no
 * headings at all -- becomes a single section with headingPath "".
 */
function splitIntoSections(content: string, headings: HeadingCache[] | undefined): Section[] {
	if (!headings || headings.length === 0) {
		return content.trim() ? [{ headingPath: "", text: content }] : [];
	}

	const lines = content.split("\n");
	const sorted = [...headings].sort((a, b) => a.position.start.line - b.position.start.line);
	const sections: Section[] = [];
	const stack: { level: number; heading: string }[] = [];

	const pushSection = (headingPath: string, startLine: number, endLine: number) => {
		const text = lines.slice(startLine, endLine).join("\n");
		if (text.trim()) sections.push({ headingPath, text });
	};

	if (sorted[0].position.start.line > 0) {
		pushSection("", 0, sorted[0].position.start.line);
	}

	for (let i = 0; i < sorted.length; i++) {
		const h = sorted[i];
		while (stack.length && stack[stack.length - 1].level >= h.level) stack.pop();
		stack.push({ level: h.level, heading: h.heading });
		const headingPath = stack.map((s) => s.heading).join(" > ");
		const startLine = h.position.start.line; // include the heading line for context
		const endLine = i + 1 < sorted.length ? sorted[i + 1].position.start.line : lines.length;
		pushSection(headingPath, startLine, endLine);
	}

	return sections;
}

/**
 * Greedily pack a section's text into ~CHUNK_CHAR_BUDGET-character pieces, preferring to split
 * on paragraph boundaries, carrying a short overlap tail into the next piece so a sentence
 * spanning a boundary still gets embedded whole in at least one chunk. A single paragraph
 * longer than the whole budget is hard-sliced (with overlap) rather than left oversized.
 */
function packSection(text: string): string[] {
	const paragraphs = text
		.split(/\n{2,}/)
		.map((p) => p.trim())
		.filter(Boolean);
	if (paragraphs.length === 0) return [];

	const pieces: string[] = [];
	let current = "";

	const flush = () => {
		if (current.trim()) pieces.push(current.trim());
	};

	for (const para of paragraphs) {
		if (para.length > CHUNK_CHAR_BUDGET) {
			flush();
			current = "";
			let offset = 0;
			while (offset < para.length) {
				const end = Math.min(para.length, offset + CHUNK_CHAR_BUDGET);
				pieces.push(para.slice(offset, end));
				if (end >= para.length) break;
				offset = end - CHUNK_OVERLAP_CHARS;
			}
			continue;
		}

		if (current.length + 2 + para.length > CHUNK_CHAR_BUDGET) {
			flush();
			const tail = current.slice(-CHUNK_OVERLAP_CHARS);
			current = tail ? `${tail}\n\n${para}` : para;
		} else {
			current = current ? `${current}\n\n${para}` : para;
		}
	}
	flush();
	return pieces;
}

/**
 * Downsample to MAX_CHUNKS_PER_NOTE by even stride across the whole note (not just truncating
 * to the head) -- new material is very often appended at the end, so a note that exceeds the
 * cap should still keep representative coverage of its later sections, not just its opening.
 */
function capChunks(chunks: RawChunk[]): RawChunk[] {
	if (chunks.length <= MAX_CHUNKS_PER_NOTE) return chunks;
	const stride = chunks.length / MAX_CHUNKS_PER_NOTE;
	const sampled: RawChunk[] = [];
	for (let i = 0; i < MAX_CHUNKS_PER_NOTE; i++) {
		sampled.push(chunks[Math.floor(i * stride)]);
	}
	return sampled;
}

/** Turn a note's full content into embeddable chunks. Never throws; a headingless or empty
 *  note just yields zero or one chunk. */
export function chunkContent(content: string, headings: HeadingCache[] | undefined): RawChunk[] {
	const sections = splitIntoSections(content, headings);
	const chunks: RawChunk[] = [];
	for (const section of sections) {
		for (const piece of packSection(section.text)) {
			chunks.push({ headingPath: section.headingPath, text: piece });
		}
	}
	return capChunks(chunks);
}
