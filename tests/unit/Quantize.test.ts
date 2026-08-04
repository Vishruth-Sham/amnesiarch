import { describe, expect, it } from "vitest";
import { dequantizeVector, quantizeVector } from "../../src/embeddings/Quantize";

describe("Quantize", () => {
	it("round-trips a normalized vector within int8 precision", () => {
		const original = [0.5, -0.5, 1, -1, 0, 0.123, -0.987];
		const b64 = quantizeVector(original);
		const restored = dequantizeVector(b64);
		expect(restored.length).toBe(original.length);
		for (let i = 0; i < original.length; i++) {
			expect(Math.abs(restored[i] - original[i])).toBeLessThan(1 / 127 + 1e-9);
		}
	});

	it("clamps out-of-range components to [-1, 1] instead of overflowing", () => {
		const b64 = quantizeVector([2, -2]);
		const restored = dequantizeVector(b64);
		expect(restored[0]).toBeCloseTo(1, 2);
		expect(restored[1]).toBeCloseTo(-1, 2);
	});

	it("round-trips an all-zero vector", () => {
		const b64 = quantizeVector([0, 0, 0]);
		const restored = dequantizeVector(b64);
		expect(Array.from(restored)).toEqual([0, 0, 0]);
	});

	it("produces a shorter base64 string than a JSON-serialized float array", () => {
		const vec = Array.from({ length: 384 }, (_, i) => Math.sin(i));
		const b64 = quantizeVector(vec);
		expect(b64.length).toBeLessThan(JSON.stringify(vec).length);
	});
});
