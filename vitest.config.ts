import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: {
			obsidian: path.resolve(__dirname, "tests/support/obsidianMock.ts"),
		},
	},
	test: {
		environment: "node",
		setupFiles: ["tests/support/setup.ts"],
		include: ["tests/**/*.test.ts"],
	},
});
