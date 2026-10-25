import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// Run under /tmp/yonder-heavy-test.lock. These are actual ordinary-temp
// processes, no production installation, permissions probes or launchd jobs.
const root = fileURLToPath(new URL("../", import.meta.url));
const evidence = await mkdtemp("/tmp/yonder-anchor-startup-");
console.log(`Anchor startup evidence: ${evidence}`);
const helper = join(evidence, "YonderHelper");
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
for (const action of ["cancel", "helper-death", "launcher-eof", "anchor-death", "bad-ack", "ack-timeout"]) {
	test(`pre-start anchor ACK gate: ${action} never runs business root and finishes bounded`, {
		timeout: 25000,
	}, async () => {
		const home = await mkdtemp(join(evidence, `${action}-`));
		await mkdir(join(home, ".yonder"));
		const marker = join(home, "business-started");
		const socket = join(home, "lease"),
			config = join(home, "config.json");
		await writeFile(
			config,
			JSON.stringify({
				launcherPid: process.pid,
				program: process.execPath,
				arguments: [
					"-e",
					`require('node:fs').writeFileSync(${JSON.stringify(marker)},'started');setInterval(()=>{},1000)`,
				],
				environment: {},
				cwd: home,
				log: join(home, "log"),
				lock: join(home, "lock"),
			}),
		);
		let connection,
			output = "",
			errors = "",
			state;
		const server = createServer((c) => {
			connection = c;
			c.on("error", () => {});
			c.on("data", (bytes) => {
				output += bytes;
				for (const line of output.split("\n").filter(Boolean)) {
					try {
						state = JSON.parse(line);
					} catch {}
				}
			});
		});
		await new Promise((r) => server.listen(socket, r));
		const processHelper = spawn(helper, ["service-host", socket, config], { stdio: ["ignore", "ignore", "pipe"] });
		processHelper.stderr.on("data", (b) => {
			errors += b;
		});
		const closed = new Promise((r) => processHelper.once("close", (code, signal) => r({ code, signal })));
		let result;
		try {
			await waitFor(() => state?.awaitingAnchorAck, "anchor registered with no ACK");
			assert.equal(state.nodePid, undefined);
			assert.equal(await exists(marker), false);
			const began = Date.now();
			if (action === "cancel") processHelper.kill("SIGTERM");
			if (action === "helper-death") processHelper.kill("SIGKILL");
			if (action === "launcher-eof") connection.end();
			if (action === "anchor-death") process.kill(state.anchorPid, "SIGKILL");
			if (action === "bad-ack")
				connection.write(`${JSON.stringify({ anchorAck: { ...state.anchor, micros: state.anchor.micros + 1 } })}\n`);
			result = await closed;
			assert.ok(Date.now() - began < 15000);
			assert.equal(await exists(marker), false, "business code must not run before both owners ACK");
			if (["anchor-death", "bad-ack", "ack-timeout"].includes(action)) assert.equal(result.code, 1);
			await waitFor(() => !alive(state.anchorPid), "anchor reclaimed");
			await writeFile(
				join(home, "result.json"),
				JSON.stringify(
					{
						state,
						result,
						errors,
						businessStarted: await exists(marker),
						remaining: [processHelper.pid, state.anchorPid].filter(alive),
					},
					null,
					2,
				),
			);
		} finally {
			connection?.destroy();
			server.close();
			if (alive(processHelper.pid)) {
				processHelper.kill("SIGTERM");
				await closed;
			}
			if (state?.anchorPid && alive(state.anchorPid)) {
				// Native cleanup revalidates its identity instead of killing a cached PID.
				await writeFile(join(home, "cleanup.json"), JSON.stringify(state));
				execFileSync(helper, ["service-cleanup", join(home, "cleanup.json")]);
			}
		}
	});
}

test("native verifier rejects stale identity and unrelated anchor, without signalling it", {
	timeout: 10000,
}, async () => {
	const home = await mkdtemp(join(evidence, "identity-"));
	const unrelated = spawn("/bin/sleep", ["30"]);
	const closed = new Promise((r) => unrelated.once("close", r));
	try {
		// Deliberately stale start time must never authorize a kill, even with the
		// correct live PID. This is not a fabricated product record.
		const stale = { pid: unrelated.pid, seconds: 1, micros: 1 };
		const file = join(home, "state.json");
		await writeFile(file, JSON.stringify({ helper: stale, anchor: stale, members: [stale] }));
		assert.throws(() => execFileSync(helper, ["service-verify-anchor", file], { stdio: "pipe" }));
		execFileSync(helper, ["service-cleanup", file]);
		assert.equal(alive(unrelated.pid), true);
		await writeFile(
			join(home, "result.json"),
			JSON.stringify({ staleRejected: true, unrelatedStillAlive: alive(unrelated.pid) }),
		);
	} finally {
		unrelated.kill();
		await closed;
	}
});
