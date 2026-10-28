import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { migrate } from "./rename-yonder.mjs";

test("rename codemod is idempotent and skips protected paths", (t) => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "yonder-rename-"));
	t.after(() => fs.rmSync(root, { recursive: true, force: true }));
	const put = (name, contents) => {
		const file = path.join(root, name);
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, contents);
	};
	put("package.json", '{"name":"@yonder/executor","dependencies":{"@yonder/execution-protocol":"1"}}');
	put("src/a.ts", 'import "hermes-experience"; // yonder-harness');
	put("docs/archive.md", "yonder-harness");
	put("CHANGELOG.md", "yonder-harness");
	put("node_modules/kept/index.js", "yonder-harness");
	put("dist/kept.js", "yonder-harness");
	put("packages/pi-durable/src/kept.ts", "yonder-harness");
	put("packages/cli/src/migrate.ts", "yonder-harness");
	put("plugins/hermes-experience/package.json", "hermes-experience");
	put("README.md", "https://github.com/GoYonderTogether/yonder-harness; cd yonder-harness; yonder-harness");

	assert.ok(migrate(root, { apply: true }).changes.length > 0);
	assert.deepEqual(migrate(root, { apply: true }).changes, []);
	assert.match(fs.readFileSync(path.join(root, "package.json"), "utf8"), /@yonder\/device/);
	assert.match(fs.readFileSync(path.join(root, "src/a.ts"), "utf8"), /learning/);
	for (const name of [
		"docs/archive.md",
		"CHANGELOG.md",
		"node_modules/kept/index.js",
		"dist/kept.js",
		"packages/pi-durable/src/kept.ts",
		"packages/cli/src/migrate.ts",
	])
		assert.equal(fs.readFileSync(path.join(root, name), "utf8"), "yonder-harness");
	assert.equal(fs.readFileSync(path.join(root, "plugins/hermes-experience/package.json"), "utf8"), "hermes-experience");
	assert.equal(
		fs.readFileSync(path.join(root, "README.md"), "utf8"),
		"https://github.com/GoYonderTogether/yonder-harness; cd yonder-harness; yonder",
	);
});
