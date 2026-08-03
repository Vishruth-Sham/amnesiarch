import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: {
			obsidian: resolve(__dirname, "tests/support/obsidianMock.ts"),
		},
	},
	test: {
		environment: "node",
		setupFiles: ["tests/support/setup.ts"],
		include: ["tests/**/*.test.ts"],
	},
});
