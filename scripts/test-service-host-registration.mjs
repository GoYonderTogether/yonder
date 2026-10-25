import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { connect, createServer } from "node:net";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Actual C descendants call the native peer-identity protocol before setsid.
// Hold /tmp/yonder-heavy-test.lock. No permissions probes or real installation.
const root = fileURLToPath(new URL("../", import.meta.url));
const evidence = await mkdtemp("/tmp/yonder-registration-");
console.log(`Registration evidence: ${evidence}`);
const helper = join(evidence, "YonderHelper"),
	fixture = join(evidence, "descendant");
await writeFile(
	join(evidence, "Main.swift"),
	"import Darwin\n@main struct Main { static func main() { exit(HelperServiceHost.run(Array(CommandLine.arguments.dropFirst()))) } }\n",
);
execFileSync("/usr/bin/swiftc", [
	join(root, "packages/macos-helper/Sources/YonderHelper/ServiceHost.swift"),
	join(evidence, "Main.swift"),
	"-o",
	helper,
]);
await writeFile(
	join(evidence, "descendant.c"),
	`
#include <unistd.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
int main(int argc, char **argv) {
 int pair[2]; if(pipe(pair)) return 20;
 pid_t child = fork(); if(child < 0) return 21;
 if(child == 0) {
  close(pair[0]); signal(SIGTERM, SIG_IGN);
  FILE *p = fopen(argv[1], "w"); fprintf(p,"%d",getpid()); fclose(p);
  int fd = socket(AF_UNIX, SOCK_STREAM, 0); struct sockaddr_un addr = {0}; addr.sun_family=AF_UNIX;
  const char *path=getenv("YONDER_SERVICE_REGISTRATION"); if(!path) return 22;
  strlcpy(addr.sun_path,path,sizeof(addr.sun_path)); if(connect(fd,(struct sockaddr*)&addr,sizeof(addr))) return 23;
  const char *msg=(argc>3 && strcmp(argv[3],"bad")==0) ? "{\\"register\\":true,\\"pid\\":1}\\n" : "{\\"register\\":true}\\n";
  if(write(fd,msg,strlen(msg)) != strlen(msg)) return 24;
  char response[4096]={0}; int used=0;
  while(used < sizeof(response)-1) { int n=read(fd,response+used,1); if(n<=0) return 25; if(response[used++]=='\\n') break; }
  if(!strstr(response,"registered")) return 26;
  close(fd);
  if(setsid()<0) return 27;
  FILE *f=fopen(argv[2],"w"); fprintf(f,"%d",getpid()); fclose(f);
  write(pair[1],"!",1); close(pair[1]); for(;;) pause();
 }
 close(pair[1]); char byte; int n=read(pair[0],&byte,1); close(pair[0]);
 if(n != 1) return 11;
 if(argc>4) { for(;;) pause(); }
 _exit(7);
}
`,
);
execFileSync("/usr/bin/cc", [join(evidence, "descendant.c"), "-o", fixture]);
const runner = join(evidence, "runner.mjs");
await writeFile(
	runner,
	`import {runServiceHost} from ${JSON.stringify(new URL("./yonder-service-host.mjs", import.meta.url).href)};try{process.exitCode=await runServiceHost({...JSON.parse(process.argv[2]),onState:s=>console.log(JSON.stringify(s))});}catch(e){console.error(e.message);process.exitCode=1;}`,
);
const alive = (pid) => {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
};
async function waitFor(check, description, timeout = 15000) {
	const end = Date.now() + timeout;
	while (Date.now() < end) {
		if (await check()) return;
		await new Promise((r) => setTimeout(r, 30));
	}
	throw new Error(`Timeout: ${description}`);
}
async function exists(path) {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}
async function pidAt(path) {
	try {
		return Number(await readFile(path, "utf8"));
	} catch {
		return undefined;
	}
}
async function run(mode, { raw = false } = {}) {
	const home = await mkdtemp(join(evidence, `${mode}-`));
	await mkdir(join(home, ".yonder/logs"), { recursive: true });
	const pidFile = join(home, "child.pid"),
		detached = join(home, "detached.pid");
	const args = [
		pidFile,
		detached,
		...(mode === "bad-message" ? ["bad"] : mode === "root-exit" ? [] : ["valid", "stay"]),
	];
	let output = "",
		errors = "",
		state,
		connection,
		server;
	let launcher;
	if (raw) {
		const socket = join(home, "lease"),
			config = join(home, "config.json");
		await writeFile(
			config,
			JSON.stringify({
				launcherPid: process.pid,
				program: fixture,
				arguments: args,
				environment: {},
				cwd: home,
				log: join(home, "log"),
				lock: join(home, "lock"),
			}),
		);
		server = createServer((c) => {
			connection = c;
			c.on("error", () => {});
			c.on("data", (b) => {
				output += b;
				parse();
			});
		});
		await new Promise((r) => server.listen(socket, r));
		launcher = spawn(helper, ["service-host", socket, config], { stdio: ["ignore", "ignore", "pipe"] });
	} else {
		launcher = spawn(
			process.execPath,
			[runner, JSON.stringify({ app: helper, direct: true, program: fixture, args, environment: {}, cwd: home, home })],
			{ stdio: ["ignore", "pipe", "pipe"] },
		);
		launcher.stdout.on("data", (b) => {
			output += b;
			parse();
		});
	}
	function parse() {
		for (const line of output.split("\n").filter(Boolean)) {
			try {
				state = JSON.parse(line);
			} catch {}
		}
	}
	launcher.stderr.on("data", (b) => {
		errors += b;
	});
	const closed = new Promise((r) => launcher.once("close", (code, signal) => r({ code, signal })));
	const pids = new Set([launcher.pid]);
	return {
		home,
		pidFile,
		detached,
		closed,
		launcher,
		get state() {
			return state;
		},
		get errors() {
			return errors;
		},
		get output() {
			return output;
		},
		send(value) {
			connection.write(`${JSON.stringify(value)}\n`);
		},
		end() {
			connection.end();
		},
		async cleanup() {
			connection?.end();
			if (alive(launcher.pid)) {
				launcher.kill("SIGTERM");
				await closed;
			}
			server?.close();
			const child = await pidAt(pidFile);
			if (child) pids.add(child);
			for (const line of output.split("\n").filter(Boolean)) {
				try {
					const s = JSON.parse(line);
					pids.add(s.helperPid);
					for (const m of s.members ?? []) pids.add(m.pid);
				} catch {}
			}
			// Exact native identities only, never process-name/global cleanup.
			if (state?.anchor) {
				const file = join(home, "cleanup-state.json");
				await writeFile(file, JSON.stringify(state));
				execFileSync(helper, ["service-cleanup", file]);
			}
			await waitFor(() => [...pids].filter(Boolean).every((pid) => !alive(pid)), "all fixture processes reclaimed");
			await writeFile(
				join(home, "result.json"),
				JSON.stringify(
					{
						output,
						errors,
						result: await closed,
						pids: [...pids],
						remaining: [...pids].filter(alive),
						detached: await exists(detached),
					},
					null,
					2,
				),
			);
		},
	};
}
for (const target of ["root-exit", "root-kill", "helper", "launcher"]) {
	test(`pre-detach both-owner ACK: ${target} cleans TERM-resistant setsid descendant`, { timeout: 25000 }, async () => {
		const r = await run(target);
		try {
			await waitFor(() => exists(r.detached), "child detaches only after ACK");
			const child = await pidAt(r.pidFile);
			await waitFor(() => r.state?.members?.some((m) => m.pid === child), "both owner identity present");
			assert.equal(
				Number(execFileSync("/bin/ps", ["-p", String(child), "-o", "pgid="], { encoding: "utf8" }).trim()),
				child,
			);
			if (target === "helper") process.kill(r.state.helperPid, "SIGKILL");
			if (target === "launcher") r.launcher.kill("SIGKILL");
			if (target === "root-kill") process.kill(r.state.nodePid, "SIGKILL");
			const result = await r.closed;
			if (target === "root-exit") assert.equal(result.code, 7);
			await waitFor(() => !alive(child), "registered detached child gone");
		} finally {
			await r.cleanup();
		}
	});
}
for (const mode of ["hold-then-ack", "bad-ack", "missing-ack", "peer-exit", "launcher-eof", "helper-death"]) {
	test(`registration ${mode}: no detach until launcher identity ACK`, { timeout: 25000 }, async () => {
		const r = await run(mode, { raw: true });
		try {
			await waitFor(() => r.state?.awaitingAnchorAck, "anchor ACK request");
			r.send({ anchorAck: r.state.anchor });
			await waitFor(() => r.state?.registering, "verified peer registration pending");
			assert.equal(await exists(r.detached), false);
			const state = r.state;
			const file = join(r.home, "verify.json");
			await writeFile(file, JSON.stringify(state));
			execFileSync(helper, ["service-verify-member", file]);
			await writeFile(
				file,
				JSON.stringify({ ...state, registering: { ...state.registering, micros: state.registering.micros + 1 } }),
			);
			assert.throws(() => execFileSync(helper, ["service-verify-member", file], { stdio: "pipe" }));
			if (mode === "hold-then-ack") {
				await new Promise((r) => setTimeout(r, 350));
				assert.equal(await exists(r.detached), false);
				r.send({ memberAck: state.registering });
				await waitFor(() => exists(r.detached), "ACK permits detach");
			} else if (mode === "bad-ack") {
				r.send({ memberAck: { ...state.registering, seconds: 1 } });
				assert.equal((await r.closed).code, 1);
			} else if (mode === "launcher-eof") {
				r.end();
				await r.closed;
			} else if (mode === "helper-death") {
				r.launcher.kill("SIGKILL");
				await r.closed;
			} else if (mode === "peer-exit") {
				process.kill(state.registering.pid, "SIGKILL");
				await r.closed;
			} else {
				await r.closed;
			}
			if (mode !== "hold-then-ack") assert.equal(await exists(r.detached), false);
		} finally {
			await r.cleanup();
		}
	});
}
test("registration rejects caller-supplied PID without arbitrary process kill", { timeout: 20000 }, async () => {
	const r = await run("bad-message");
	try {
		assert.equal((await r.closed).code, 11);
		assert.equal(await exists(r.detached), false);
	} finally {
		await r.cleanup();
	}
});
test("registration rejects unrelated real peer, leaves it alive", { timeout: 20000 }, async () => {
	const r = await run("unrelated");
	let peer;
	try {
		await waitFor(() => exists(r.detached), "service running");
		// The test process is not in the managed ancestry. Native LOCAL_PEERPID,
		// not a claimed PID in JSON, is used to reject it.
		const cmd = execFileSync("/bin/ps", ["-p", String(r.state.helperPid), "-o", "command="], { encoding: "utf8" });
		const socket = `${cmd.match(/service-host (\S+) /)[1]}.register`;
		peer = connect(socket);
		peer.on("error", () => {});
		const closed = new Promise((resolve) => peer.on("close", resolve));
		peer.write('{"register":true}\n');
		await closed;
		assert.equal(alive(process.pid), true);
		assert.equal(
			r.state.members.some((m) => m.pid === process.pid),
			false,
		);
	} finally {
		peer?.destroy();
		await r.cleanup();
	}
});
