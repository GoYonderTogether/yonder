import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { migrate } from "./rename-yonder.mjs";

function temporaryRoot(t) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "yonder-rename-"));
	t.after(() => {
		const resolved = path.resolve(root);
		assert.equal(path.dirname(resolved), path.resolve(os.tmpdir()));
		assert.ok(path.basename(resolved).startsWith("yonder-rename-"));
		fs.rmSync(resolved, { recursive: true, force: true });
	});
	return root;
}
function put(root, name, contents) {
	const file = path.join(root, name);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, contents);
}
function cliFixture(t) {
	const sandbox = temporaryRoot(t);
	const script = path.join(sandbox, "tool space % # 测试", "rename tool.mjs");
	const root = path.join(sandbox, "target space % # 测试");
	put(
		sandbox,
		path.relative(sandbox, script),
		fs.readFileSync(new URL("./rename-yonder.mjs", import.meta.url), "utf8"),
	);
	put(root, "package.json", '{"name":"@yonder/executor"}');
	put(root, "docs/verification/kept.md", "yonder-harness");
	const run = (args, cwd = root) => {
		const result = spawnSync(process.execPath, [script, ...args], { cwd, encoding: "utf8", timeout: 10_000 });
		assert.ifError(result.error);
		return result;
	};
	return { sandbox, script, root, run };
}

test("rename codemod is idempotent and skips protected paths", (t) => {
	const root = temporaryRoot(t);
	const put = (name, contents) => {
		const file = path.join(root, name);
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, contents);
	};
	put("package.json", '{"name":"@yonder/executor","dependencies":{"@yonder/execution-protocol":"1"}}');
	put("src/a.ts", 'import "hermes-experience"; // yonder-harness');
	put("install.ts", 'const root = ".yonder-harness";');
	put("docs/migrate.md", "把旧 `yonder-harness` 用户数据");
	put("plugins/learning/src/owner.mjs", 'const old = "hermes-experience";');
	put("docs/archive.md", "yonder-harness");
	put("CHANGELOG.md", "yonder-harness");
	put("node_modules/kept/index.js", "yonder-harness");
	put("dist/kept.js", "yonder-harness");
	put("packages/pi-durable/src/kept.ts", "yonder-harness");
	put("packages/cli/src/migrate.ts", "yonder-harness");
	put("plugins/hermes-experience/package.json", "hermes-experience");
	put("README.md", "https://github.com/GoYonderTogether/yonder-harness; cd yonder-harness; yonder-harness");

	const kept = ["install.ts", "docs/migrate.md", "plugins/learning/src/owner.mjs"].map((name) => [
		name,
		fs.readFileSync(path.join(root, name), "utf8"),
	]);
	assert.ok(migrate(root, { apply: true }).changes.length > 0);
	assert.deepEqual(migrate(root, { apply: true }).changes, []);
	for (const [name, text] of kept) assert.equal(fs.readFileSync(path.join(root, name), "utf8"), text);
	assert.match(fs.readFileSync(path.join(root, "package.json"), "utf8"), /@yonder\/device/);
	assert.match(fs.readFileSync(path.join(root, "src/a.ts"), "utf8"), /hermes-experience/);
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

test("all migration, history, alias and third-party protections survive native path traversal", (t) => {
	const root = temporaryRoot(t);
	const protectedPaths = [
		".git/kept.json",
		"nested/node_modules/pkg/kept.js",
		"nested/dist/kept.js",
		"packages/pi-durable/src/kept.ts",
		"docs/archive.md",
		"notes/archive.md",
		"docs/decisions.md",
		"CHANGELOG.md",
		"nested/CHANGELOG.zh.md",
		"packages/cli/src/migrate.ts",
		"packages/cli/src/migrate/settings.ts",
		"packages/cli/src/migrate-user-data.ts",
		"scripts/migrate/rename-yonder.mjs",
		"docs/verification/proof.md",
		"proposals/unified-client/plan.md",
		".workbuddy-ai/memory/user.md",
		"plugins/hermes-experience/src/alias.ts",
		"third_party/pi-ai/package.json",
	];
	const editablePaths = [
		"src/active.ts",
		"scripts/migrate-next/run.mjs",
		"docs/verification-next/proof.md",
		"proposals/unified-client-next/plan.md",
		".workbuddy-ai/memory-next/user.md",
		"plugins/hermes-experience-next/src/alias.ts",
		"third_party-next/notes.md",
	];
	for (const name of [...protectedPaths, ...editablePaths]) put(root, name, "yonder-harness");
	const expected = editablePaths.map((name) => path.normalize(name)).sort();
	assert.deepEqual(
		migrate(root)
			.changes.map((change) => change.file)
			.sort(),
		expected,
	);
	for (const name of [...protectedPaths, ...editablePaths])
		assert.equal(fs.readFileSync(path.join(root, name), "utf8"), "yonder-harness");
	assert.deepEqual(
		migrate(root, { apply: true })
			.changes.map((change) => change.file)
			.sort(),
		expected,
	);
	for (const name of protectedPaths)
		assert.equal(fs.readFileSync(path.join(root, name), "utf8"), "yonder-harness", name);
	for (const name of editablePaths) assert.equal(fs.readFileSync(path.join(root, name), "utf8"), "yonder", name);
	assert.deepEqual(migrate(root, { apply: true }).changes, []);
});

test("CLI dry-run and apply support explicit roots and URL-escaped script paths", (t) => {
	const { sandbox, root, run } = cliFixture(t);
	const before = fs.readFileSync(path.join(root, "package.json"), "utf8");
	const dryRun = run(["--dry-run", root], sandbox);
	assert.equal(dryRun.status, 0, dryRun.stderr);
	assert.match(dryRun.stdout, /would change: package\.json/);
	assert.match(dryRun.stdout, /Summary: 1 files, 1 replacements/);
	assert.equal(fs.readFileSync(path.join(root, "package.json"), "utf8"), before);
	const applied = run(["--apply", root], sandbox);
	assert.equal(applied.status, 0, applied.stderr);
	assert.match(applied.stdout, /changed: package\.json/);
	assert.equal(fs.readFileSync(path.join(root, "package.json"), "utf8"), '{"name":"@yonder/device"}');
	assert.equal(fs.readFileSync(path.join(root, "docs/verification/kept.md"), "utf8"), "yonder-harness");
	const repeated = run(["--apply"]);
	assert.equal(repeated.status, 0, repeated.stderr);
	assert.match(repeated.stdout, /Summary: 0 files, 0 replacements/);
});

test("CLI rejects missing modes and excess arguments without modifying the selected root", (t) => {
	const { root, run } = cliFixture(t);
	for (const args of [[], ["--unknown"], ["--dry-run", root, "unexpected"], ["--apply", root, "unexpected"]]) {
		const result = run(args);
		assert.equal(result.status, 2, result.stderr);
		assert.match(result.stderr, /Usage:/);
		assert.equal(result.stdout, "");
		assert.equal(fs.readFileSync(path.join(root, "package.json"), "utf8"), '{"name":"@yonder/executor"}');
	}
});

test("importing the CLI from an encoded path does not execute a migration", (t) => {
	const { root, script } = cliFixture(t);
	const result = spawnSync(
		process.execPath,
		["--input-type=module", "-e", `await import(${JSON.stringify(pathToFileURL(script).href)});`],
		{ cwd: root, encoding: "utf8", timeout: 10_000 },
	);
	assert.ifError(result.error);
	assert.equal(result.status, 0, result.stderr);
	assert.equal(result.stdout, "");
	assert.equal(result.stderr, "");
	assert.equal(fs.readFileSync(path.join(root, "package.json"), "utf8"), '{"name":"@yonder/executor"}');
});
