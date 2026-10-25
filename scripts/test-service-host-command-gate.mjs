import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Deterministic launcher transport contract: hold/reject a phase without any
// product test switches. Native Helper/identity verifier and bash tool are real.
const root = fileURLToPath(new URL("../", import.meta.url));
const helper = join(root, "packages/macos-helper/dist/Yonder Helper.app/Contents/MacOS/YonderHelper");
const evidence = await mkdtemp("/tmp/yonder-command-gate-");
console.log(`Command gate evidence: ${evidence}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const alive = (pid) => {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
};
async function exists(path) {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}
async function until(check, label) {
	const end = Date.now() + 16000;
	while (Date.now() < end) {
		if (await check()) return;
		await sleep(20);
	}
	throw new Error(`Timeout: ${label}`);
}
for (const stage of ["prepare", "ready"]) {
	for (const action of ["cancel", "bad-ack", "timeout", "helper-death"]) {
		test(`command two-phase gate ${stage}: ${action}`, { timeout: 35000 }, async () => {
			const home = await mkdtemp(join(evidence, `${stage}-${action}-`));
			await mkdir(join(home, ".yonder"));
			const socket = join(home, "lease");
			const config = join(home, "launch.json");
			await writeFile(
				config,
				JSON.stringify({
					launcherPid: process.pid,
					program: process.execPath,
					arguments: [join(root, "scripts/fixtures/service-command-runner.mjs"), home, "gate"],
					environment: { ...process.env },
					cwd: home,
					log: join(home, "log"),
					lock: join(home, "lock"),
				}),
			);
			let state, connection, held, protocolError;
			const seen = new Set(),
				snapshots = [];
			const pids = new Set();
			const native = (mode, value) => {
				const path = join(home, `${mode}.json`);
				return writeFile(path, JSON.stringify(value)).then(() => execFileSync(helper, [mode, path]));
			};
			const server = createServer((c) => {
				connection = c;
				let buffer = "";
				c.on("error", () => {});
				c.on("data", (b) => {
					buffer += b;
					let end = buffer.indexOf("\n");
					while (end >= 0) {
						const frame = JSON.parse(buffer.slice(0, end));
						buffer = buffer.slice(end + 1);
						end = buffer.indexOf("\n");
						state = { ...state, ...frame };
						for (const item of state.members ?? []) pids.add(item.pid);
						for (const item of state.commandGroups ?? []) pids.add(item.pid);
						if (state.nodePid) pids.add(state.nodePid);
						if (state.helper) pids.add(state.helper.pid);
						if (state.awaitingAnchorAck && !seen.has("anchor")) {
							seen.add("anchor");
							const value = state;
							void native("service-verify-anchor", value)
								.then(() => c.write(`${JSON.stringify({ anchorAck: value.anchor })}\n`))
								.catch((error) => {
									protocolError = error;
									c.end();
								});
						}
						if (state.registering && state.groupStage) {
							const value = state;
							const key = value.groupStage;
							if (seen.has(key)) continue;
							seen.add(key);
							snapshots.push(value);
							void native("service-verify-member", value)
								.then(async () => {
									if (key === stage) {
										held = value;
										if (action === "cancel") {
											await writeFile(join(home, "abort"), "cancel");
											return;
										}
										if (action === "timeout" || action === "helper-death") return;
									}
									const ack =
										key === stage && action === "bad-ack"
											? { ...value.registering, micros: value.registering.micros + 1 }
											: value.registering;
									c.write(`${JSON.stringify({ memberAck: ack, groupStage: key })}\n`);
								})
								.catch((error) => {
									protocolError = error;
									c.end();
								});
						}
					}
				});
			});
			await new Promise((r) => server.listen(socket, r));
			const owner = spawn(helper, ["service-host", socket, config], { stdio: ["ignore", "ignore", "pipe"] });
			pids.add(owner.pid);
			let errors = "";
			owner.stderr.on("data", (b) => {
				errors += b;
			});
			const closed = new Promise((r) => owner.once("close", r));
			try {
				await until(() => held, "requested phase held");
				assert.equal(await exists(join(home, "business-started")), false);
				if (stage === "prepare")
					assert.equal(
						execFileSync("/bin/ps", ["-o", "pgid=", "-p", String(held.registering.pid)], { encoding: "utf8" }).trim(),
						String(held.anchor.pid),
					);
				if (stage === "ready")
					assert.equal(
						execFileSync("/bin/ps", ["-o", "pgid=", "-p", String(held.registering.pid)], { encoding: "utf8" }).trim(),
						String(held.registering.pid),
					);
				if (action === "helper-death") {
					owner.kill("SIGKILL");
					await closed;
					await native("service-cleanup", held);
				} else if (action === "bad-ack") {
					assert.equal(await closed, 1, "corrupt pending identity fails the host protocol");
				} else {
					await until(() => exists(join(home, "gate-result.json")), "bash tool reports failed gate");
					const result = JSON.parse(await readFile(join(home, "gate-result.json"), "utf8"));
					assert.ok(result.error, JSON.stringify(result));
					await closed;
				}
				assert.equal(protocolError, undefined);
				assert.equal(await exists(join(home, "business-started")), false);
				await until(() => [...pids].every((pid) => !alive(pid)), "recorded gate/owner PIDs disappear");
				await writeFile(
					join(home, "result.json"),
					JSON.stringify(
						{ action, stage, snapshots, pids: [...pids], remaining: [...pids].filter(alive), errors },
						null,
						2,
					),
				);
			} finally {
				connection?.end();
				if (state) await native("service-cleanup", state);
				if (alive(owner.pid)) owner.kill("SIGTERM");
				await closed;
				connection?.destroy();
				server.close();
				await writeFile(
					join(home, "cleanup.json"),
					JSON.stringify({ pids: [...pids], remaining: [...pids].filter(alive) }, null, 2),
				);
			}
		});
	}
}
