import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { setAwake, startAwake } from "../packages/cli/dist/awake.js";

if (process.platform !== "win32") throw new Error("Native Windows required");
const root = await mkdtemp(join(tmpdir(), "yonder-power-"));
let active = 0;
const lease = startAwake(root, async () => ({ active }));
async function waitFor(check) {
	const end = Date.now() + 15000;
	while (Date.now() < end) {
		const state = await lease.refresh();
		if (check(state)) return state;
		await sleep(200);
	}
	throw new Error(JSON.stringify(lease.status()));
}
try {
	await setAwake(root, "always");
	assert.equal((await waitFor((s) => s.protected === true)).provider, "SetThreadExecutionState");
	await setAwake(root, "tasks");
	await waitFor((s) => s.mode === "tasks" && s.protected === false);
	active = 1;
	await waitFor((s) => s.protected === true);
	active = 0;
	await waitFor((s) => s.reason === "grace" && s.protected === true);
	await setAwake(root, "off");
	await waitFor((s) => s.protected === false && s.mode === "off");
	console.log(
		"PASS: real Windows power lease acquired, tasks/idle/grace/off acknowledged, no global power policy changed",
	);
} finally {
	lease.close();
	await rm(root, { recursive: true, force: true });
}
