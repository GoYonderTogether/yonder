// Contract fixture invokes the real registered bash ToolRegistration, no model.
import assert from "node:assert/strict";
import { access, readFile, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { processTool } from "../../packages/core/dist/runtime/process.js";

const [home, mode, sameGroup] = process.argv.slice(2);
const jobs = new Map();
const tool = processTool(home, jobs);
let taskId = 0;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check) {
	for (let i = 0; i < 500; i++) {
		if (await check()) return;
		await sleep(10);
	}
	throw new Error("fixture wait timed out");
}
const results = [];
function run(command, options = {}, controller = new AbortController()) {
	const id = ++taskId;
	jobs.set(id, { output: "" });
	const api = { taskId: id, env: { id: "node:local", cwd: home }, output() {} };
	const done = tool.execute({ command, ...options }, api, { abortSignal: controller.signal }).then((result) => {
		const value = JSON.parse(result.output[0].text);
		results.push({ id, ...value });
		return value;
	});
	// Attach rejection handler immediately, cancellation is intentionally tested.
	done.catch(() => {});
	return { id, done, controller };
}
if (mode === "contract") {
	const cancelled = new AbortController();
	cancelled.abort(new Error("pre-ACK cancel"));
	await assert.rejects(run("touch must-not-execute", {}, cancelled).done, /pre-ACK cancel/);
	const basic = await run("printf 'normal'; printf 'error' >&2; exit 7").done;
	assert.equal(basic.exitCode, 7);
	assert.equal(basic.signal, null);
	assert.match(basic.output, /normal/);
	assert.match(basic.output, /error/);
	assert.equal(basic.stderr, "error");
	const signalled = await run("kill -TERM $$").done;
	assert.equal(signalled.exitCode, null);
	assert.equal(signalled.signal, "SIGTERM");
	const cwd = await run('printf \'%s|%s\' "$PWD" "$YONDER_COMMAND_FIXTURE"', { cwd: home }).done;
	assert.equal(cwd.output, `${await realpath(home)}|inherited`);
	const input = run("cat", { stdin: true });
	await until(() => jobs.get(input.id)?.write);
	await jobs.get(input.id).write("first\n");
	await jobs.get(input.id).write("last\n", true);
	assert.equal((await input.done).output, "first\nlast\n");
	const large = await run("/usr/bin/head -c 262144 /dev/zero | /usr/bin/tr '\\0' x").done;
	assert.equal(large.output.length, 65536);
	assert.equal((await readFile(large.fullOutputPath)).length, 262144);
	const timeout = await run("sleep 0.1; printf elapsed", { timeout: 0.05 }).done;
	assert.equal(timeout.exitCode, 0);
	assert.match(timeout.output, /still running/);
	const victim = run("trap '' TERM; echo $$ > victim.pid; while :; do sleep 1; done");
	const survivor = run("sleep 1.5; echo survivor");
	await until(async () => {
		try {
			return await readFile(join(home, "victim.pid"));
		} catch {
			return false;
		}
	});
	const start = Date.now();
	victim.controller.abort(new Error("cancel only victim"));
	await assert.rejects(victim.done, /cancel only victim/);
	assert.ok(Date.now() - start >= 900, "TERM-resistant bash keeps the 1s grace");
	assert.equal((await survivor.done).output, "survivor\n");
	const quick = await run(`${JSON.stringify(sameGroup)} ${JSON.stringify(join(home, "descendant.pid"))}`).done;
	assert.equal(quick.exitCode, 7);
	const child = Number(await readFile(join(home, "descendant.pid"), "utf8"));
	await until(() => {
		try {
			process.kill(child, 0);
			return false;
		} catch {
			return true;
		}
	});
	await assert.rejects(access(join(home, "must-not-execute")));
	await writeFile(join(home, "results.json"), JSON.stringify(results, null, 2));
} else if (mode.startsWith("gate")) {
	const pending = run("touch business-started");
	const timer = setInterval(async () => {
		try {
			await access(join(home, "abort"));
			pending.controller.abort(new Error("gate cancellation"));
		} catch {}
	}, 10);
	try {
		await pending.done;
		await writeFile(join(home, "gate-result.json"), JSON.stringify({ executed: true }));
	} catch (error) {
		await writeFile(join(home, "gate-result.json"), JSON.stringify({ error: error.message }));
	} finally {
		clearInterval(timer);
	}
} else {
	const pending = run(
		`exec ${JSON.stringify(sameGroup)} ${JSON.stringify(join(home, "descendant.pid"))}${mode.startsWith("quick-") ? "" : " hold"}`,
	);
	await pending.done; // Owner death may terminate Node first; no synthetic success.
}
