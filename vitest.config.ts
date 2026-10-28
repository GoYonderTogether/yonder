import { defineConfig } from "vitest/config";

// Several tests spawn the built CLI or wait on real services; the 5s default only measures machine load.
export default defineConfig({
	test: {
		testTimeout: 20000,
		hookTimeout: 20000,
		// node:test 文件由 npm run test:node 执行，避免 Vitest 报 "No test suite found"。
		exclude: [
			"**/node_modules/**",
			"**/dist/**",
			"scripts/export-model-observations.test.mjs",
			"scripts/migrate/rename-yonder.test.mjs",
			"scripts/test/names-consistency.test.mjs",
			"packages/macos/test/install-root.test.mjs",
		],
	},
});
