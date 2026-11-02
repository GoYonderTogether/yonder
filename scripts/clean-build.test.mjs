import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

const script = fileURLToPath(new URL("./clean-build.mjs", import.meta.url));
test("clean-build removes only the existing build outputs, including paths with spaces", () => {
	const root = mkdtempSync(join(tmpdir(), "yonder clean-build "));
	try {
		const outputs = ["packages/core/dist/a.js", "plugins/native-automation/dist/a.js", "apps/app/dist/a.js"];
		const preserved = ["packages/core/src/a.ts", "plugins/native-automation/src/a.ts", "apps/other/dist/a.js"];
		for (const path of [...outputs, ...preserved]) {
			mkdirSync(dirname(join(root, path)), { recursive: true });
			writeFileSync(join(root, path), "build-clean boundary");
		}
		for (let attempt = 0; attempt < 2; attempt++) {
			const result = spawnSync(process.execPath, [script], { cwd: root, encoding: "utf8" });
			assert.equal(result.status, 0, result.stderr);
			for (const path of outputs) assert.equal(existsSync(join(root, path)), false, path);
			for (const path of preserved) assert.equal(existsSync(join(root, path)), true, path);
		}
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
