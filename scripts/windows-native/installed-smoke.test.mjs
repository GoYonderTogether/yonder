import assert from "node:assert/strict";
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
