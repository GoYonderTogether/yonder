// Explicit local integration check. Uses real native tasks, bash and the installed power helper; no model.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT as C } from "@earendil-works/chord/context";
import { defineExtension, defineTask } from "@earendil-works/pi-durable";
import { setAwake, startAwake } from "../packages/cli/dist/awake.js";
import { resolveProfile } from "../packages/core/dist/config/index.js";
import { openDatabase } from "../packages/core/dist/runtime/db.js";
import { Runtime } from "../packages/core/dist/runtime/index.js";

const seconds = Number(process.argv[2] ?? 8);
assert(Number.isInteger(seconds) && seconds >= 5 && seconds <= 180);
const home = await mkdtemp(join(tmpdir(), "yonder-awake-live-"));
let runtime, host;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
try {
	runtime = await Runtime.open({
		home,
		db: await openDatabase(join(home, "state.db")),
		config: { schema: 1 },
		resolveSession: async () => ({
			agent: null,
			profile: "default",
			cwd: home,
			resolved: resolveProfile({ level: "bypass" }),
		}),
	});
	const driver = defineTask({
		name: "yonder.awake-check",
		version: 1,
		initial: () => ({ phase: "run" }),
		phases: {
			async run(job, task, context) {
				const api = {
					conversationId: job.conversationId,
					taskId: job.id,
					callId: "awake-check",
					async commit(change, ctx) {
						let result;
						await task.commit(async (tx) => {
							result = await change(tx);
							return undefined;
						}, ctx);
						return result;
					},
					async createTask(child, input, options, ctx) {
						let id;
						await task.commit(async (tx) => {
							id = await tx.createTask(child, input, { ...options, conversationId: job.conversationId });
							return undefined;
						}, ctx);
						return id;
					},
				};
				const result = await runtime.tools
					.get("bash")
					.execute({ command: `sleep ${seconds}; printf 'awake task completed'`, background: true }, api, context);
				await task.commit(() => ({ status: "terminal", outcome: { status: "completed", result } }), context);
			},
		},
	});
	runtime.registry.install(defineExtension({ name: "yonder.awake-check", tasks: [driver] }));
	const session = await runtime.create({ agent: null, profile: "default", cwd: home });
	await runtime.configure(session);
	await setAwake(home, true);
	host = startAwake(home, async () => ({ active: (await runtime.hasAwakeWork(session)) ? 1 : 0 }));
	const driverId = await runtime.harness.commit(
		(tx) =>
			tx.createTask(
				driver,
				{},
				{ conversationId: Number(session), ownership: { kind: "conversation" }, background: true },
			),
		C,
	);
	const started = await runtime.harness.waitForTask(driverId, C);
	assert.equal(started.state.outcome.status, "completed");
	assert(started.state.outcome.result.details?.background, "real background bash must start");
	let protectedSeen = false,
		closedSeen = false,
		maxGap = 0,
		last = Date.now();
	const deadline = Date.now() + (seconds + 15) * 1000;
	while (Date.now() < deadline) {
		await wait(1000);
		const now = Date.now();
		maxGap = Math.max(maxGap, now - last);
		last = now;
		const state = await host.refresh();
		if (state.protected && state.active > 0) protectedSeen = true;
		const info = execFileSync("/usr/sbin/ioreg", ["-r", "-n", "IOPMrootDomain", "-d", "1"], { encoding: "utf8" });
		if (/"AppleClamshellState"\s*=\s*Yes/.test(info)) closedSeen = true;
		console.log(
			JSON.stringify({
				at: new Date().toISOString(),
				active: state.active,
				protected: state.protected,
				lidClosed: closedSeen,
			}),
		);
		if (protectedSeen && state.active === 0 && !state.protected) break;
	}
	assert(protectedSeen, "task must acquire real system protection");
	assert.equal(host.status().active, 0);
	assert.equal(host.status().protected, false);
	console.log(JSON.stringify({ passed: true, physicalLidObserved: closedSeen, maxHeartbeatGapMs: maxGap, home }));
} finally {
	host?.close();
	await runtime?.close();
	await rm(home, { recursive: true, force: true });
}
