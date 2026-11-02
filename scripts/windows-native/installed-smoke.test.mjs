import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { verifyServiceInfo } from "./installed-smoke.mjs";

const home = resolve("temporary-smoke-home");
const record = { version: "0.3.26110201", commit: "a".repeat(40) };
const info = { ...record, ready: true, pid: 123, home };
test("service proof requires the installed version, commit, process and home", () => {
	assert.doesNotThrow(() => verifyServiceInfo(info, 123, record, home));
	for (const patch of [
		{ ready: false },
		{ pid: 124 },
		{ version: "0.3.26110202" },
		{ commit: "b".repeat(40) },
		{ home: resolve("other-smoke-home") },
	])
		assert.throws(() => verifyServiceInfo({ ...info, ...patch }, 123, record, home));
});

test("Windows installer uses npm.cmd and retains failure checks for both build commands", () => {
	const source = readFileSync(new URL("../install.ps1", import.meta.url), "utf8");
	assert.match(source, /@\('git', 'npm.cmd', 'node'\)/);
	assert.match(source, /& npm\.cmd ci --no-audit --no-fund\r?\n\s*if \(\$LASTEXITCODE -ne 0\)/);
	assert.match(source, /& npm\.cmd run build\r?\n\s*if \(\$LASTEXITCODE -ne 0\)/);
	assert.doesNotMatch(source, /^\s*& npm /m);
});
