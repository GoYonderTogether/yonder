// Live, non-prompting acceptance. Run after npm run build on macOS, never grants permissions.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import plugin from "../dist/index.js";

const data = await mkdtemp(join(tmpdir(), "yonder-helper-check-"));
const tools = new Map(),
	triggers = [];
const ctx = {
	session: "helper-check",
	env: { id: "node:local" },
	capabilities: ["exec", "read", "write", "message"],
	signal: new AbortController().signal,
};
let passed = 0;
try {
	await plugin.setup({
		paths: { data },
		// Setup-only fixture; permission operations are not invoked by this script.
		permissions: { register() {} },
		tools: { register: (tool) => tools.set(tool.name, tool) },
		events: { on() {} },
		triggers: { register: (trigger) => triggers.push(trigger) },
	});
	const call = (args) => tools.get("native-automation_desktop").execute(args, ctx);
	const reply = await call({ action: "permissions" });
	assert.equal(reply.isError, undefined, reply.text);
	const status = JSON.parse(reply.text).result;
	assert.equal(status.permissions.length, 9);
	passed++;
	assert.deepEqual(status.probeChecks, { passed: 4, failed: 0 });
	passed++;
	for (const record of status.permissions) {
		assert.ok(record.lastCheckedAt && "lastRequestedAt" in record && record.nextStep);
		assert.equal(record.responsibleIdentity.bundleID, "dev.yonder.harness.helper");
		assert.ok(record.responsibleIdentity.codeHash && record.responsibleIdentity.designatedRequirement);
		if (record.state === "granted") assert.ok(record.grantedAt);
		if (["full-disk-access", "files-and-folders"].includes(record.kind)) assert.equal(record.state, "unobservable");
		passed++;
	}
	const app = join(homedir(), ".local/share/yonder/helper/Yonder Helper.app");
	const before = await stat(app);
	const again = await call({ action: "status" });
	assert.equal(again.isError, undefined, again.text);
	assert.equal((await stat(app)).mtimeMs, before.mtimeMs);
	passed++;
	const state = JSON.parse(
		await readFile(join(homedir(), ".local/share/yonder/helper/permissions-state.json"), "utf8"),
	);
	assert.equal(state.length, 9);
	assert.deepEqual(
		state.map((record) => record.lastRequestedAt),
		status.permissions.map((record) => record.lastRequestedAt),
	);
	passed++;
	const screenshot = await call({ action: "screenshot" });
	if (status.screenCapture) {
		assert.equal(screenshot.isError, undefined, screenshot.text);
		assert.deepEqual(
			Buffer.from(screenshot.images[0].data, "base64").subarray(0, 8),
			Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
		);
	} else {
		assert.equal(screenshot.isError, true);
		assert.ok(
			screenshot.text.includes(
				`screen-recording: ${status.permissions.find((record) => record.kind === "screen-recording").state}`,
			),
		);
		const record = status.permissions.find((record) => record.kind === "screen-recording");
		assert.ok(JSON.parse(screenshot.text).error.includes(record.nextStep));
	}
	passed++;
	// This diagnostic context has no owner-origin input, so even a valid new action must fail before transport.
	const forbidden = await call({ action: "permission-request", kind: "camera" });
	assert.equal(forbidden.isError, true);
	assert.match(JSON.parse(forbidden.text).error, /owner input/);
	passed++;
	const self = JSON.parse(
		execFileSync(process.execPath, ["scripts/yonder-permissions.mjs", "self-check"], { encoding: "utf8" }),
	);
	assert.equal(self.failed, 0);
	passed += self.passed;
	for (const kind of ["accessibility", "screen-recording"]) {
		const watched = spawnSync(process.execPath, ["scripts/yonder-permissions.mjs", "watch", kind, "--timeout", "0.1"], {
			encoding: "utf8",
			timeout: 10000,
		});
		assert.equal(watched.error, undefined);
		const final = JSON.parse(watched.stdout.trim().split("\n").at(-1));
		assert.equal(watched.status, final.exitCode);
		assert.equal(final.outcome, final.permission.state === "granted" ? "granted" : "timeout");
		assert.equal(
			final.permission.lastRequestedAt,
			status.permissions.find((record) => record.kind === kind).lastRequestedAt,
		);
		passed++;
	}
	console.log(
		JSON.stringify({
			passed,
			failed: 0,
			screenCapture: status.screenCapture,
			permissions: status.permissions.map(({ kind, state, raw }) => ({ kind, state, raw })),
			screenshot: status.screenCapture ? "PNG verified" : "not-granted + owner command verified",
			stateMachine: self,
		}),
	);
} finally {
	for (const trigger of triggers) await trigger.stop();
	await rm(data, { recursive: true, force: true });
}
