// Exercise the installed CLI and its real local control listener, without sending a model input.
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

export function verifyServiceInfo(info, pid, record, home) {
	assert.equal(info.ready, true, "installed service is not ready");
	assert.equal(info.pid, pid, "control endpoint belongs to a different process");
	assert.equal(info.version, record.version, "running version differs from installed release");
	assert.equal(info.commit, record.commit, "running commit differs from installed release");
	assert.equal(resolve(info.home), resolve(home), "control endpoint belongs to a different home");
}

export async function smokeInstalled(root, home) {
	root = resolve(root);
	home = resolve(home);
	const record = JSON.parse(await readFile(join(root, ".yonder-install.json"), "utf8"));
	const cli = join(root, "packages/cli/dist/index.js");
	const { requestControl } = await import(pathToFileURL(join(root, "packages/core/dist/index.js")).href);
	for (let round = 1; round <= 2; round++) {
		const child = spawn(process.execPath, [cli, "--home", home, "--json", "start"], {
			cwd: root,
			env: { ...process.env, YONDER_HOME: home },
			stdio: ["ignore", "pipe", "pipe"],
		});
		let log = "";
		child.stdout.on("data", (chunk) => {
			log = (log + chunk).slice(-32000);
		});
		child.stderr.on("data", (chunk) => {
			log = (log + chunk).slice(-32000);
		});
		const exited = new Promise((done) => {
			child.once("error", (error) => done({ error }));
			child.once("exit", (code, signal) => done({ code, signal }));
		});
		// Bound startup and shutdown, and never leave the process owned by this smoke running on failure.
		let timer;
		const timedOut = new Promise((_, reject) => {
			timer = setTimeout(() => reject(new Error(`installed lifecycle timed out\n${log}`)), 90000);
		});
		try {
			await Promise.race([
				(async () => {
					let info;
					for (;;) {
						if (child.exitCode !== null || child.signalCode !== null)
							throw new Error(`installed service exited\n${log}`);
						try {
							info = await requestControl(home, { method: "service.info" });
							break;
						} catch {
							await delay(200);
						}
					}
					verifyServiceInfo(info, child.pid, record, home);
					const gatewayFile = join(home, ".yonder/gateway.json");
					const gateway = JSON.parse(await readFile(gatewayFile, "utf8"));
					assert.equal(gateway.pid, child.pid, "default gateway belongs to a different process");
					const page = await fetch(`http://127.0.0.1:${gateway.port}${gateway.basePath}`, {
						signal: AbortSignal.timeout(5000),
					});
					assert.equal(page.status, 200, "installed gateway did not serve the application");
					await page.arrayBuffer();
					await promisify(execFile)(process.execPath, [cli, "--home", home, "--json", "stop"], { timeout: 20000 });
					assert.deepEqual(await exited, { code: 0, signal: null }, log);
					await assert.rejects(requestControl(home, { method: "service.info" }), "control listener survived stop");
					await assert.rejects(readFile(gatewayFile), { code: "ENOENT" });
				})(),
				timedOut,
			]);
			console.log(
				`Installed lifecycle ${round}: gateway + service.info + clean stop passed (${record.tag} ${record.commit})`,
			);
		} finally {
			clearTimeout(timer);
			if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
			await exited;
		}
	}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	if (process.argv.length !== 4)
		throw new Error("Usage: installed-smoke.mjs <installed-release-root> <temporary-home>");
	await smokeInstalled(process.argv[2], process.argv[3]);
}
