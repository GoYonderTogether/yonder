import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { runServiceHost } from "./yonder-service-host.mjs";

// Full Helper must be built first; hold /tmp/yonder-heavy-test.lock for this suite.
const root = fileURLToPath(new URL("../", import.meta.url));
const app = join(root, "packages/macos-helper/dist/Yonder Helper.app");
const helper = join(app, "Contents/MacOS/YonderHelper");
await access(helper);
const evidence = await mkdtemp("/tmp/yonder-command-");
console.log(`Command evidence: ${evidence}`);
const sameGroup = join(evidence, "same-group");
await writeFile(
	join(evidence, "same-group.c"),
	`#include <unistd.h>
#include <stdio.h>
#include <signal.h>
int main(int argc,char **argv){ pid_t child=fork(); if(child==0){signal(SIGTERM,SIG_IGN);for(;;)pause();} FILE *f=fopen(argv[1],"w");fprintf(f,"%d",child);fclose(f);if(argc>2){for(;;)pause();}return 7;}
`,
);
execFileSync("/usr/bin/clang", [join(evidence, "same-group.c"), "-o", sameGroup]);
const alive = (pid) => {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(check, label, ms = 18000) {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		if (await check()) return;
		await sleep(25);
	}
	throw new Error(`Timeout: ${label}`);
}
async function exists(path) {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

// This file also serves as the real launcher process for single-owner SIGKILL.
if (process.argv[2] === "driver") {
	const [home, mode] = process.argv.slice(3);
	const identities = new Map();
	process.exitCode = await runServiceHost({
		app: helper,
		direct: true,
		program: process.execPath,
		args: [
			join(root, process.env.YONDER_HOST_TEST_RUNNER ?? "scripts/fixtures/service-command-runner.mjs"),
			home,
			mode,
			process.argv[5],
		],
		environment: { ...process.env, YONDER_COMMAND_FIXTURE: "inherited" },
		cwd: home,
		home,
		onState(state) {
			writeFileSync(join(home, "state.json"), JSON.stringify(state));
			for (const item of [state.helper, ...state.members, ...(state.commandGroups ?? [])])
				identities.set(`${item.pid}:${item.seconds}:${item.micros}`, item);
			writeFileSync(join(home, "identities.json"), JSON.stringify([...identities.values()]));
		},
	});
} else {
	for (const mode of ["contract", "helper-death", "launcher-death", "quick-helper-death", "quick-launcher-death"]) {
		test(`real ${process.env.YONDER_HOST_TEST_RUNNER ? "env exec" : "bash tool"} hosted command: ${mode}`, {
			timeout: 60000,
		}, async () => {
			const home = await mkdtemp(join(evidence, `${mode}-`));
			await mkdir(join(home, ".yonder"));
			const driver = spawn(process.execPath, [fileURLToPath(import.meta.url), "driver", home, mode, sameGroup], {
				stdio: ["ignore", "pipe", "pipe"],
			});
			let output = "";
			driver.stdout.on("data", (b) => {
				output += b;
			});
			driver.stderr.on("data", (b) => {
				output += b;
			});
			const closed = new Promise((resolve) => driver.once("close", (code, signal) => resolve({ code, signal })));
			const pids = new Set([driver.pid]);
			let state;
			try {
				if (mode !== "contract") {
					await until(() => exists(join(home, "descendant.pid")), "bash descendant started");
					await until(async () => {
						try {
							state = JSON.parse(await readFile(join(home, "state.json"), "utf8"));
							return state.commandGroups?.length;
						} catch {
							return false;
						}
					}, "command group published");
					for (const item of state.members) pids.add(item.pid);
					for (const item of state.commandGroups) pids.add(item.pid);
					pids.add(state.helper.pid);
					const child = Number(await readFile(join(home, "descendant.pid"), "utf8"));
					pids.add(child);
					const snapshot = execFileSync("/bin/ps", ["-o", "pid,ppid,pgid,stat,comm", "-p", [...pids].join(",")], {
						encoding: "utf8",
					});
					await writeFile(join(home, "before-death.json"), JSON.stringify({ state, child, snapshot }, null, 2));
					if (mode.startsWith("quick-")) {
						assert.equal(
							execFileSync("/bin/ps", ["-o", "ppid=", "-p", String(child)], { encoding: "utf8" }).trim(),
							"1",
							"rapid shell has exited before owner death",
						);
						assert.ok(
							state.commandGroups.some(
								(item) =>
									String(item.pid) ===
									execFileSync("/bin/ps", ["-o", "pgid=", "-p", String(child)], { encoding: "utf8" }).trim(),
							),
						);
					}
					process.kill(mode.includes("helper-death") ? state.helper.pid : driver.pid, "SIGKILL");
				}
				const outcome = await closed;
				state = JSON.parse(await readFile(join(home, "state.json"), "utf8"));
				for (const item of JSON.parse(await readFile(join(home, "identities.json"), "utf8"))) pids.add(item.pid);
				if (mode === "contract") {
					assert.equal(outcome.code, 0, output);
					state = JSON.parse(await readFile(join(home, "state.json"), "utf8"));
					for (const item of [...state.members, ...state.commandGroups]) pids.add(item.pid);
					pids.add(state.helper.pid);
					pids.add(Number(await readFile(join(home, "descendant.pid"), "utf8")));
					pids.add(Number(await readFile(join(home, "victim.pid"), "utf8")));
				}
				await until(() => [...pids].every((pid) => !alive(pid)), "all recorded command/owner fixture PIDs reclaimed");
				await writeFile(
					join(home, "result.json"),
					JSON.stringify({ mode, outcome, pids: [...pids], remaining: [...pids].filter(alive), output }, null, 2),
				);
			} finally {
				// Only identities from this fixture, no process-name/full-machine scan.
				if (state) {
					const file = join(home, "cleanup-state.json");
					await writeFile(file, JSON.stringify(state));
					execFileSync(helper, ["service-cleanup", file]);
				}
				if (alive(driver.pid)) driver.kill("SIGTERM");
				await closed;
				await writeFile(
					join(home, "cleanup.json"),
					JSON.stringify({ pids: [...pids], remaining: [...pids].filter(alive), output }, null, 2),
				);
			}
		});
	}
}
