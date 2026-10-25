import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Real ordinary-temp process fixtures, not product data or TCC probes.
// Run while holding /tmp/yonder-heavy-test.lock; no launchd bootstrap/install.
const root = fileURLToPath(new URL("../", import.meta.url));
const evidence = await mkdtemp("/tmp/yonder-host-evidence-");
console.log(`Lifecycle evidence: ${evidence}`);
const executable = join(evidence, "YonderHelper");
await writeFile(
	join(evidence, "Main.swift"),
	"import Darwin\n@main struct Main { static func main() { exit(HelperServiceHost.run(Array(CommandLine.arguments.dropFirst()))) } }\n",
);
execFileSync("/usr/bin/swiftc", [
	process.env.YONDER_HOST_TEST_SOURCE ?? join(root, "packages/macos-helper/Sources/YonderHelper/ServiceHost.swift"),
	join(evidence, "Main.swift"),
	"-o",
	executable,
]);
const app = join(evidence, "Yonder Helper.app");
await mkdir(join(app, "Contents/MacOS"), { recursive: true });
execFileSync("/bin/cp", [executable, join(app, "Contents/MacOS/YonderHelper")]);
await writeFile(
	join(app, "Contents/Info.plist"),
	'<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleExecutable</key><string>YonderHelper</string><key>CFBundleIdentifier</key><string>dev.yonder.harness.helper</string><key>CFBundlePackageType</key><string>APPL</string><key>LSUIElement</key><true/></dict></plist>',
);
if (process.env.YONDER_HOST_TEST_APP) {
	await cp(process.env.YONDER_HOST_TEST_APP, app, { recursive: true, force: true });
	console.log(`Testing full signed product app copied from ${process.env.YONDER_HOST_TEST_APP}`);
} else execFileSync("/usr/bin/codesign", ["--force", "--sign", "-", app]);
const hostExecutable = process.env.YONDER_HOST_TEST_APP ? join(app, "Contents/MacOS/YonderHelper") : executable;
const runner = join(evidence, "runner.mjs");
await writeFile(
	runner,
	`import {runServiceHost} from ${JSON.stringify(new URL("./yonder-service-host.mjs", import.meta.url).href)};\nconst options=JSON.parse(process.argv[2]);try {process.exitCode=await runServiceHost({...options,onState:s=>{console.log(JSON.stringify(s));if(options.failState)throw new Error("fixture onState failure");}});}catch(e){console.error(e.message);process.exitCode=1;}\n`,
);
const tree = join(evidence, "tree.mjs");
await writeFile(
	tree,
	`import {spawn} from 'node:child_process';\nconst child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:'ignore'});\nconsole.log(JSON.stringify({cwd:process.cwd(),env:process.env.YONDER_HOST_FIXTURE,child:child.pid}));console.error('fixture stderr');setInterval(()=>{},1000);\n`,
);
async function waitFor(fn, description, timeout = 15000) {
	const end = Date.now() + timeout;
	while (Date.now() < end) {
		if (await fn()) return;
		await new Promise((r) => setTimeout(r, 50));
	}
	throw new Error(`Timeout: ${description}`);
}
function alive(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}
async function start(name, { home, direct = true, args = [tree], failState = false, executableOverride } = {}) {
	home ??= await mkdtemp(join(evidence, `${name}-`));
	const options = {
		app: executableOverride ?? (direct ? hostExecutable : app),
		failState,
		direct,
		program: process.execPath,
		args,
		environment: { ...process.env, YONDER_HOST_FIXTURE: "ordinary-temp" },
		cwd: home,
		home,
	};
	const launcher = spawn(process.execPath, [runner, JSON.stringify(options)], { stdio: ["ignore", "pipe", "pipe"] });
	let output = "",
		errors = "",
		state;
	launcher.stdout.on("data", (b) => {
		output += b;
		for (const line of output.trim().split("\n")) {
			try {
				state = JSON.parse(line);
			} catch {}
		}
	});
	launcher.stderr.on("data", (b) => {
		errors += b;
	});
	const closed = new Promise((resolve) => launcher.on("close", (code, signal) => resolve({ code, signal })));
	return {
		launcher,
		closed,
		home,
		get state() {
			return state;
		},
		async ready() {
			await waitFor(() => state?.nodePid && state?.members?.length >= (args[0] === tree ? 3 : 2), `${name} ready`);
		},
		async save() {
			await writeFile(
				join(evidence, `${name}.json`),
				JSON.stringify(
					{
						options: { ...options, environment: { YONDER_HOST_FIXTURE: options.environment.YONDER_HOST_FIXTURE } },
						state,
						output,
						errors,
						result: await closed,
					},
					null,
					2,
				),
			);
		},
		async gone() {
			const pids = [state?.helperPid, ...(state?.members ?? []).map((x) => x.pid)].filter(Boolean);
			await waitFor(() => pids.every((pid) => !alive(pid)), `${name} process tree gone`);
		},
	};
}
for (const direct of [true, false]) {
	test(`${direct ? "direct" : "LaunchServices"}: real Node cwd/env/logs, TERM, duplicate, stop/start`, {
		timeout: 60000,
	}, async () => {
		const name = direct ? "direct-term" : "ls-term";
		const first = await start(name, { direct });
		try {
			await first.ready();
			const log = await readFile(join(first.home, ".yonder/logs/harness.log"), "utf8");
			assert.match(log, /ordinary-temp/);
			assert.match(log, /fixture stderr/);
			assert.ok(log.includes(first.home.replace(/^\/tmp\//, "/private/tmp/")));
			assert.equal(alive(first.launcher.pid), true, "foreground launcher must stay alive");
			const duplicate = await start(`${name}-duplicate`, { home: first.home, direct });
			assert.equal((await duplicate.closed).code, 1);
			await duplicate.save();
			assert.equal(alive(first.state.nodePid), true);
			first.launcher.kill("SIGTERM");
			await first.closed;
			await first.gone();
			await first.save();
			const next = await start(`${name}-restart`, { home: first.home, direct });
			await next.ready();
			next.launcher.kill("SIGTERM");
			await next.closed;
			await next.gone();
			await next.save();
		} finally {
			if (alive(first.launcher.pid)) {
				first.launcher.kill("SIGTERM");
				await first.closed;
			}
		}
	});
}
for (const target of ["node", "helper", "launcher"]) {
	test(`SIGKILL ${target}: surviving owner cleans the actual Node/detached child tree`, {
		timeout: 30000,
	}, async () => {
		const run = await start(`crash-${target}`);
		try {
			await run.ready();
			process.kill(target === "launcher" ? run.launcher.pid : run.state[`${target}Pid`], "SIGKILL");
			await run.closed;
			await run.gone();
			await run.save();
		} finally {
			if (alive(run.launcher.pid)) {
				run.launcher.kill("SIGTERM");
				await run.closed;
			}
		}
	});
}
test("Node ordinary exit propagates actual status; invalid Node option fails without lingering host", {
	timeout: 30000,
}, async () => {
	const run = await start("exit-7", { args: ["-e", "console.log('normal exit');setTimeout(()=>process.exit(7),300)"] });
	await run.ready();
	assert.equal((await run.closed).code, 7);
	await run.gone();
	await run.save();
	const bad = await start("bad-program", { args: ["--not-a-real-node-option"] });
	assert.notEqual((await bad.closed).code, 0);
	await bad.gone();
	await bad.save();
});

test("full Helper LaunchServices actually hosts built Node CLI start and control stop", {
	skip: !process.env.YONDER_HOST_TEST_CLI,
	timeout: 45000,
}, async () => {
	const cli = process.env.YONDER_HOST_TEST_CLI;
	const home = await mkdtemp(join(evidence, "real-cli-"));
	await writeFile(
		join(home, "yonder.yaml"),
		"schema: 1\nplugins:\n  - use: '@yonder/plugin-ui-companion'\n    config:\n      desktop: false\nagents: []\n",
	);
	const run = await start("real-cli", { home, direct: false, args: [cli, "start", "--home", home, "--json"] });
	let info;
	try {
		await run.ready();
		await waitFor(() => {
			try {
				info = JSON.parse(
					execFileSync(process.execPath, [cli, "service", "info", "--home", home, "--json"], {
						encoding: "utf8",
						stdio: ["ignore", "pipe", "pipe"],
					}),
				);
				return info.ready;
			} catch {
				return false;
			}
		}, "actual CLI control readiness");
		assert.equal(info.pid, run.state.nodePid);
		assert.equal(info.home, home);
		execFileSync(process.execPath, [cli, "stop", "--home", home, "--json"]);
		assert.equal((await run.closed).code, 0);
		await run.gone();
		await run.save();
		await writeFile(join(evidence, "actual-cli-info.json"), JSON.stringify(info, null, 2));
	} finally {
		if (alive(run.launcher.pid)) {
			run.launcher.kill("SIGTERM");
			await run.closed;
		}
	}
});

// The grandchild appears and loses its parent entirely between two host ticks.
// It stays in the root's group, ignores TERM, and is never in the PID snapshot.
const groupFixture = join(evidence, "group-fixture");
await writeFile(
	join(evidence, "group.c"),
	`
#include <unistd.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
int main(int argc, char **argv) {
 usleep(30000);
 pid_t child = fork();
 if (child == 0) { if (argc > 2) setsid(); signal(SIGTERM, SIG_IGN); for (;;) pause(); }
 FILE *f = fopen(argv[1], "w"); fprintf(f, "%d", child); fclose(f);
 _exit(7);
}
`,
);
execFileSync("/usr/bin/cc", [join(evidence, "group.c"), "-o", groupFixture]);
test("exited root pins group until cleanup, including unobserved TERM-resistant grandchild", {
	timeout: 25000,
}, async () => {
	const home = await mkdtemp(join(evidence, "unobserved-group-"));
	const childFile = join(home, "child.pid");
	await mkdir(join(home, ".yonder/logs"), { recursive: true });
	const options = {
		app: hostExecutable,
		direct: true,
		program: groupFixture,
		args: [childFile],
		environment: {},
		cwd: home,
		home,
	};
	const launcher = spawn(process.execPath, [runner, JSON.stringify(options)], { stdio: ["ignore", "pipe", "pipe"] });
	let output = "",
		errors = "",
		child;
	launcher.stdout.on("data", (b) => {
		output += b;
	});
	launcher.stderr.on("data", (b) => {
		errors += b;
	});
	const closed = new Promise((resolve) => launcher.once("close", (code, signal) => resolve({ code, signal })));
	try {
		await waitFor(async () => {
			try {
				child = Number(await readFile(childFile, "utf8"));
				return child > 1;
			} catch {
				return false;
			}
		}, "grandchild pid");
		const result = await closed;
		await writeFile(
			join(evidence, "unobserved-group.json"),
			JSON.stringify({ child, output, errors, result }, null, 2),
		);
		assert.equal(result.code, 7);
		assert.equal(
			output
				.split("\n")
				.filter(Boolean)
				.some((line) => JSON.parse(line).members?.some((m) => m.pid === child)),
			false,
			"fixture must escape snapshots",
		);
		await waitFor(() => !alive(child), "unobserved group child gone", 3000);
	} finally {
		if (child && alive(child)) process.kill(child, "SIGKILL");
		if (alive(launcher.pid)) {
			launcher.kill("SIGTERM");
			await closed;
		}
	}
});

test("onState throw still closes lease, cleans subtree and returns failure", { timeout: 30000 }, async () => {
	const run = await start("state-error", { failState: true });
	assert.equal((await run.closed).code, 1);
	await run.gone();
	await run.save();
});

for (const connect of [false, true]) {
	test(`TERM ${connect ? "with uncooperative lease" : "before lease"} has bounded shutdown`, {
		timeout: 25000,
	}, async () => {
		const fake = join(evidence, `uncooperative-${connect}.mjs`);
		const ready = join(evidence, `uncooperative-${connect}.ready`);
		await writeFile(
			fake,
			`#!/usr/bin/env node\nimport {connect} from 'node:net';import {writeFileSync} from 'node:fs';process.on('SIGTERM',()=>{});${connect ? "const s=connect({path:process.argv[3],allowHalfOpen:true});s.on('end',()=>{});s.on('error',()=>{});" : ""}writeFileSync(${JSON.stringify(ready)},String(process.pid));setInterval(()=>{},1000);\n`,
		);
		execFileSync("chmod", ["+x", fake]);
		const run = await start(`uncooperative-${connect}`, { executableOverride: fake });
		await waitFor(async () => {
			try {
				await readFile(ready);
				return true;
			} catch {
				return false;
			}
		}, "fixture ready");
		const begin = Date.now();
		run.launcher.kill("SIGTERM");
		assert.equal((await run.closed).code, 1);
		assert.ok(Date.now() - begin < 16000);
		assert.equal(alive(Number(await readFile(ready, "utf8"))), false);
		await run.save();
	});
}

// Exercise the real nonblocking socket writer with a payload much larger than
// SO_SNDBUF. The receiver verifies exact bytes, then another peer stops reading.
test("Swift frame writer completes partial writes and bounds EAGAIN", { timeout: 20000 }, async () => {
	const main = join(evidence, "Transport.swift");
	await writeFile(
		main,
		`import Foundation
import Darwin
@main struct Main {
 static func main() throws {
  signal(SIGPIPE, SIG_IGN)
  var pair: [Int32] = [0,0]
  precondition(socketpair(AF_UNIX, SOCK_STREAM, 0, &pair) == 0)
  let writer = pair[0], reader = pair[1]
  var size: Int32 = 1024
  setsockopt(writer, SOL_SOCKET, SO_SNDBUF, &size, socklen_t(MemoryLayout<Int32>.size))
  _ = fcntl(writer, F_SETFL, O_NONBLOCK)
  let payload = Data(repeating: 65, count: 262144)
  let done = DispatchSemaphore(value: 0)
  DispatchQueue.global().async {
   usleep(50000)
   var received = Data(); var bytes = [UInt8](repeating: 0, count: 4096)
   while received.count < payload.count {
    let n = recv(reader, &bytes, bytes.count, 0)
    precondition(n > 0); received.append(contentsOf: bytes.prefix(n))
   }
   precondition(received == payload); done.signal()
  }
  try HelperServiceHost.sendFrame(writer, payload)
  done.wait()
  let start = Date()
  do { try HelperServiceHost.sendFrame(writer, Data(repeating: 66, count: 1048576)); fatalError("expected timeout") }
  catch { precondition(Date().timeIntervalSince(start) < 2); print("partial exact; EAGAIN bounded") }
  close(reader)
  do { try HelperServiceHost.sendFrame(writer, payload); fatalError("expected disconnect") }
  catch { print("disconnect throws") }
  close(writer)
 }
}
`,
	);
	const binary = join(evidence, "transport");
	execFileSync("/usr/bin/swiftc", [
		join(root, "packages/macos-helper/Sources/YonderHelper/ServiceHost.swift"),
		main,
		"-o",
		binary,
	]);
	const output = execFileSync(binary, [], { encoding: "utf8" });
	assert.match(output, /partial exact; EAGAIN bounded/);
	assert.match(output, /disconnect throws/);
	await writeFile(join(evidence, "transport.txt"), output);
});

test("known boundary: unobserved setsid descendant survives (fixture explicitly reclaimed)", {
	timeout: 20000,
}, async () => {
	const home = await mkdtemp(join(evidence, "unobserved-setsid-"));
	const childFile = join(home, "child.pid");
	const options = {
		app: hostExecutable,
		direct: true,
		program: groupFixture,
		args: [childFile, "detach"],
		environment: {},
		cwd: home,
		home,
	};
	const launcher = spawn(process.execPath, [runner, JSON.stringify(options)], { stdio: ["ignore", "pipe", "pipe"] });
	let output = "",
		errors = "",
		child;
	launcher.stdout.on("data", (b) => {
		output += b;
	});
	launcher.stderr.on("data", (b) => {
		errors += b;
	});
	const closed = new Promise((resolve) => launcher.once("close", (code, signal) => resolve({ code, signal })));
	try {
		await waitFor(async () => {
			try {
				child = Number(await readFile(childFile, "utf8"));
				return child > 1;
			} catch {
				return false;
			}
		}, "detached pid");
		const result = await closed;
		assert.equal(result.code, 7);
		const observed = output
			.split("\n")
			.filter(Boolean)
			.some((line) => JSON.parse(line).members?.some((m) => m.pid === child));
		assert.equal(observed, false);
		assert.equal(alive(child), true, "negative evidence: existing architecture cannot reclaim this child");
		await writeFile(
			join(evidence, "known-boundary-setsid.json"),
			JSON.stringify({ child, observed, survived: alive(child), output, errors, result }, null, 2),
		);
	} finally {
		if (child && alive(child)) process.kill(child, "SIGKILL");
		if (alive(launcher.pid)) {
			launcher.kill("SIGTERM");
			await closed;
		}
		if (child) await waitFor(() => !alive(child), "negative fixture reclaimed");
	}
});

test("post-spawn lease write throw executes cleanup and waitpid before Helper exit", { timeout: 20000 }, async () => {
	const scratch = await mkdtemp("/tmp/yonder-service-");
	const home = await mkdtemp(join(evidence, "lease-write-error-"));
	await mkdir(join(home, ".yonder/logs"), { recursive: true });
	const socket = join(scratch, "lease");
	const config = join(scratch, "launch.json");
	await writeFile(
		config,
		JSON.stringify({
			launcherPid: process.pid,
			program: process.execPath,
			arguments: [tree],
			environment: { ...process.env },
			cwd: home,
			log: join(home, ".yonder/logs/harness.log"),
			lock: join(home, ".yonder/service-host.lock"),
		}),
	);
	let lease,
		output = "",
		errors = "",
		rootPid,
		child;
	const server = createServer((connection) => {
		lease = connection;
		connection.on("error", () => {});
		connection.on("data", (b) => {
			output += b;
			for (const line of output.split("\n").filter(Boolean)) {
				try {
					const state = JSON.parse(line);
					if (state.awaitingAnchorAck) connection.write(`${JSON.stringify({ anchorAck: state.anchor })}\n`);
				} catch {}
			}
		});
	});
	await new Promise((resolve) => server.listen(socket, resolve));
	const helper = spawn(hostExecutable, ["service-host", socket, config], { stdio: ["ignore", "ignore", "pipe"] });
	helper.stderr.on("data", (b) => {
		errors += b;
	});
	const closed = new Promise((resolve) => helper.once("close", (code, signal) => resolve({ code, signal })));
	try {
		await waitFor(async () => {
			try {
				rootPid = output
					.split("\n")
					.filter(Boolean)
					.map((line) => JSON.parse(line))
					.find((state) => state.nodePid)?.nodePid;
				const log = await readFile(join(home, ".yonder/logs/harness.log"), "utf8");
				child = JSON.parse(log.split("\n").find((line) => line.startsWith("{"))).child;
				return child > 1;
			} catch {
				return false;
			}
		}, "lease and actual child");
		lease.destroy();
		const result = await closed;
		assert.equal(result.code, 1);
		assert.match(errors, /Lease write failed or timed out/);
		assert.equal(alive(rootPid), false, "root reaped before Helper exit");
		await waitFor(() => !alive(child), "write-error child gone");
		await writeFile(
			join(evidence, "lease-write-error.json"),
			JSON.stringify({ rootPid, child, output, errors, result }, null, 2),
		);
	} finally {
		lease?.destroy();
		server.close();
		if (alive(helper.pid)) {
			helper.kill("SIGTERM");
			await closed;
		}
		for (const pid of [rootPid, child]) if (pid && alive(pid)) process.kill(pid, "SIGKILL");
		await rm(scratch, { recursive: true, force: true });
	}
});
