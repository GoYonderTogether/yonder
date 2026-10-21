import { defineConfig } from "vitest/config";

// Several tests spawn the built CLI or wait on real services; the 5s default only measures machine load.
export default defineConfig({ test: { testTimeout: 20000, hookTimeout: 20000 } });
