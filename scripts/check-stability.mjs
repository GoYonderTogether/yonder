import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const checks = [
	["registry", "node_modules/vitest/vitest.mjs", "run", "packages/core/src/control/registry.golden.test.ts"],
	["events", "node_modules/vitest/vitest.mjs", "run", "packages/gateway/src/events.golden.test.ts"],
	["views", "node_modules/vitest/vitest.mjs", "run", "packages/sdk/src/views.golden.test.ts"],
	["config", "node_modules/vitest/vitest.mjs", "run", "packages/core/src/config/schema.golden.test.ts"],
	["plugin API version", "node_modules/vitest/vitest.mjs", "run", "packages/core/src/plugins/api-version.test.ts"],
	["store migrations", "node_modules/vitest/vitest.mjs", "run", "packages/core/src/store/migrations.test.ts"],
	["names consistency", "--test", "scripts/test/names-consistency.test.mjs"],
	["package versions", "scripts/version-check.mjs", "--check"],
];

for (const [name, ...args] of checks) {
	console.log(`\nChecking ${name}...`);
	const result = spawnSync(process.execPath, args, { cwd: root, stdio: "inherit" });
	if (result.status !== 0) {
		console.error(`${name} freeze check failed; see docs/spec/20-stability.md.`);
		if (result.error) console.error(result.error.message);
		process.exit(1);
	}
}
