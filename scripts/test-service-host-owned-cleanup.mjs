import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Acceptance gate, not a test that treats survival as success. The original
// known-boundary test stays unchanged in test-service-host.mjs. Hold the shared
// /tmp/yonder-heavy-test.lock while running this real ordinary-temp fixture.
const root = fileURLToPath(new URL("../", import.meta.url));
const alive = (pid) => {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
};
async function waitFor(check, description, timeout = 15000) {
	const deadline = Date.now() + timeout;
	while (Date.now() < deadline) {
		if (await check()) return;
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	throw new Error(`Timeout: ${description}`);
}

test("owned cleanup must reclaim the original unobserved setsid counterexample", {
	skip: process.platform !== "darwin",
	timeout: 30000,
}, async () => {
	const evidence = await mkdtemp("/tmp/yonder-owned-cleanup-");
	console.log(`Owned cleanup acceptance evidence: ${evidence}`);
	const helper = join(evidence, "YonderHelper");
	const fixture = join(evidence, "escape");
	const childFile = join(evidence, "child.pid");
	const main = join(evidence, "Main.swift");
	await writeFile(
		main,
		"import Darwin\n@main struct Main { static func main() { exit(HelperServiceHost.run(Array(CommandLine.arguments.dropFirst()))) } }\n",
	);
	execFileSync("/usr/bin/swiftc", [
		join(root, "packages/macos-helper/Sources/YonderHelper/ServiceHost.swift"),
		main,
		"-o",
		helper,
	]);
	// Same timing and fork/setsid/exit shape as the original counterexample.
	await writeFile(
		join(evidence, "escape.c"),
		`
#include <unistd.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
int main(int argc, char **argv) {
 usleep(30000);
 pid_t child = fork();
 if (child == 0) { setsid(); signal(SIGTERM, SIG_IGN); for (;;) pause(); }
 FILE *f = fopen(argv[1], "w"); fprintf(f, "%d", child); fclose(f);
 _exit(7);
}
`,
	);
	execFileSync("/usr/bin/cc", [join(evidence, "escape.c"), "-o", fixture]);
	const runner = join(evidence, "runner.mjs");
	await writeFile(
		runner,
		`import {runServiceHost} from ${JSON.stringify(new URL("./yonder-service-host.mjs", import.meta.url).href)};
try { process.exitCode = await runServiceHost({...JSON.parse(process.argv[2]), onState: s => console.log(JSON.stringify(s))}); }
catch (e) { console.error(e.message); process.exitCode = 1; }
`,
	);
	const options = {
		app: helper,
		direct: true,
		program: fixture,
		args: [childFile, "detach"],
		environment: {},
		cwd: evidence,
		home: evidence,
	};
	const launcher = spawn(process.execPath, [runner, JSON.stringify(options)], { stdio: ["ignore", "pipe", "pipe"] });
	let output = "",
		errors = "",
		child,
		result;
	launcher.stdout.on("data", (bytes) => {
		output += bytes;
	});
	launcher.stderr.on("data", (bytes) => {
		errors += bytes;
	});
	const closed = new Promise((resolve) => launcher.once("close", (code, signal) => resolve({ code, signal })));
	const pids = new Set([launcher.pid]);
	let record = {};
	try {
		await waitFor(async () => {
			try {
				child = Number(await readFile(childFile, "utf8"));
				return child > 1;
			} catch {
				return false;
			}
		}, "fixture child pid");
		pids.add(child);
		result = await closed;
		const states = output
			.split("\n")
			.filter(Boolean)
			.map((line) => JSON.parse(line));
		for (const state of states) {
			pids.add(state.helperPid);
			for (const member of state.members ?? []) pids.add(member.pid);
		}
		const observed = states.some((state) => state.members?.some((member) => member.pid === child));
		let processState = null;
		if (alive(child))
			processState = execFileSync("/bin/ps", ["-p", String(child), "-o", "pid=,ppid=,pgid=,command="], {
				encoding: "utf8",
			}).trim();
		record = { child, observed, survived: alive(child), result, states, errors, processState };
		await writeFile(join(evidence, "result.json"), JSON.stringify(record, null, 2));
		assert.equal(result.code, 7, "actual fixture exit status must propagate");
		assert.equal(observed, false, "must reproduce the unobserved original escape");
		// A surviving child is an acceptance FAILURE, never a passing boundary test.
		await waitFor(() => !alive(child), "owned setsid descendant reclaimed by host", 3000);
	} finally {
		if (alive(launcher.pid)) {
			launcher.kill("SIGTERM");
			await closed;
		}
		// Never kill by name or scan user processes. Only this fixture's recorded
		// PID is eligible, with its unique executable path checked again.
		if (child && alive(child)) {
			const command = execFileSync("/bin/ps", ["-p", String(child), "-o", "command="], { encoding: "utf8" }).trim();
			assert.ok(command.startsWith(`${fixture} `), "refuse cleanup if fixture PID identity changed");
			process.kill(child, "SIGKILL");
		}
		await waitFor(() => [...pids].filter(Boolean).every((pid) => !alive(pid)), "all recorded fixture PIDs reclaimed");
		await writeFile(
			join(evidence, "cleanup.json"),
			JSON.stringify(
				{ pids: [...pids], remaining: [...pids].filter((pid) => pid && alive(pid)), reclaimed: true },
				null,
				2,
			),
		);
	}
});
