import { defineConfig } from "vitest/config";

// Several tests spawn the built CLI or wait on real services; the 5s default only measures machine load.
export default defineConfig({
	test: {
		testTimeout: 20000,
		hookTimeout: 20000,
		// `scripts/export-model-observations.test.mjs` 用 node:test 编写，由 `npm run test:node` 运行；
		// vitest 收集不到它的用例，留在默认 include 里会让整套测试报 "No test suite found"。
		exclude: [
			"**/node_modules/**",
			"**/dist/**",
			"scripts/export-model-observations.test.mjs",
			"scripts/migrate/rename-yonder.test.mjs",
		],
	},
});
