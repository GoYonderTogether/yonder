import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

test("status install root honors override and falls back only during migration", {
	skip: process.platform !== "darwin",
}, () => {
	const directory = mkdtempSync(join(tmpdir(), "yonder-status-install-"));
	try {
		const source = readFileSync(new URL("../YonderStatus.swift", import.meta.url), "utf8");
		const expression = source.match(/private let install: String = (\{[\s\S]*?\}\(\))/u)?.[1];
		assert.ok(expression);
		const script = join(directory, "check.swift");
		writeFileSync(
			script,
			`import Foundation\nlet install: String = ${expression.replaceAll("NSHomeDirectory()", 'ProcessInfo.processInfo.environment["TEST_HOME"]!')}\nprint(install)\n`,
		);
		const current = join(directory, ".local/share/yonder/install");
		const legacy = join(directory, ".yonder-harness");
		const run = (override) => {
			const env = { ...process.env, TEST_HOME: directory };
			delete env.YONDER_INSTALL;
			if (override !== undefined) env.YONDER_INSTALL = override;
			const result = spawnSync("/usr/bin/swift", [script], { encoding: "utf8", env });
			assert.equal(result.status, 0, result.stderr);
			return result.stdout.trim();
		};
		assert.equal(run(), current);
		mkdirSync(legacy);
		assert.equal(run(), legacy);
		mkdirSync(current, { recursive: true });
		assert.equal(run(), current);
		assert.equal(run("/custom/install"), "/custom/install");
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});
