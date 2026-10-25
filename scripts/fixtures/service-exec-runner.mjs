// Actual local env, Runtime and SDK/cron entrypoints under a real native host.
// No model is selected, no credentials or production home are used.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { access, chmod, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { BACKGROUND_CONTEXT as C, withAbortSignal } from "@earendil-works/chord/context";
import { resolveProfile } from "../../packages/core/dist/config/index.js";
import { openKernel } from "../../packages/core/dist/kernel/index.js";
import { openDatabase } from "../../packages/core/dist/runtime/db.js";
import { localEnvironment } from "../../packages/core/dist/runtime/env.js";
import { createGrepTool } from "../../packages/core/dist/runtime/grep.js";
import { hostedProcessSpawner } from "../../packages/core/dist/runtime/hosted-process.js";
import { Runtime } from "../../packages/core/dist/runtime/index.js";
import { processTool } from "../../packages/core/dist/runtime/process.js";

const [home, mode, sameGroup] = process.argv.slice(2);
const env = localEnvironment(home); // consumes fd4 once; bash below must use its cache.
const results = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(check) {
	for (let i = 0; i < 500; i++) {
		if (await check()) return;
		await sleep(10);
	}
	throw new Error("exec fixture wait timed out");
}
async function run(command, options = {}, controller = new AbortController(), target = env) {
	let stdout = "",
		stderr = "";
	const value = await target.exec(
		command,
		{
			...options,
			onOutput(text, _context, info) {
				if (info.stream === "stderr") stderr += text;
				else stdout += text;
				options.onOutput?.(text, _context, info);
			},
		},
		withAbortSignal(controller.signal, C),
	);
	results.push({ command, result: value, stdoutBytes: stdout.length, stderrBytes: stderr.length });
	return { value, stdout, stderr };
}
function succeeded(value) {
	assert.equal(value.ok, true, value.error?.message);
	return value.value;
}
async function kernelContracts() {
	const data = join(home, "sdk-home"),
		plugin = join(data, "plugin");
	await mkdir(plugin, { recursive: true });
	await mkdir(join(data, "presets"));
	const cronURL = new URL("../../plugins/cron/dist/index.js", import.meta.url).href;
	const manifest = JSON.parse(await readFile(new URL("../../plugins/cron/package.json", import.meta.url), "utf8"));
	manifest.yonder.entry = "./index.mjs";
	await writeFile(join(plugin, "package.json"), JSON.stringify(manifest));
	await writeFile(
		join(plugin, "index.mjs"),
		`import cron from ${JSON.stringify(cronURL)};export let api;export const tools=[];export default {async setup(value){api=value;await cron.setup({...value,tools:{register(tool){tools.push(tool);value.tools.register(tool)}}});}};`,
	);
	await writeFile(join(data, "yonder.yaml"), `schema: 1\nplugins:\n  - use: ${JSON.stringify(plugin)}\n`);
	await writeFile(
		join(data, "presets/exec.yaml"),
		"schema: 1\ndescription: Hosted execution contract\nmodel: openai/gpt-6-luna\nlevel: bypass\n",
	);
	const kernel = await openKernel(data);
	try {
		const session = await kernel.sessions.open({ preset: "exec", close: "manual" });
		const { api, tools } = await import(pathToFileURL(join(plugin, "index.mjs")).href);
		const owner = { session: session.id, agent: session.agent, profile: session.profile };
		const request = {
			owner,
			capabilities: ["exec"],
			command: [
				process.execPath,
				"-e",
				"process.stdout.write('sdk argv');process.stderr.write('sdk err');process.exit(7)",
			],
		};
		assert.deepEqual(await api.execution.run(request), { stdout: "sdk argv", stderr: "sdk err", exitCode: 7 });
		assert.deepEqual(await api.execution.run({ ...request, command: "printf 'sdk string'" }), {
			stdout: "sdk string",
			stderr: "",
			exitCode: 0,
		});
		await assert.rejects(api.execution.run({ ...request, capabilities: [] }), /capability/);
		await assert.rejects(api.execution.run({ ...request, owner: { ...owner, profile: "wrong-owner" } }), /owner/);
		const ctx = { ...owner, capabilities: ["exec"], env, signal: new AbortController().signal };
		const tool = tools.find((item) => item.name === "cron_exec");
		const created = JSON.parse(
			(
				await tool.execute(
					{
						action: "create",
						job: {
							name: "Hosted cron command contract",
							enabled: false,
							schedule: { kind: "at", at: new Date(Date.now() + 3600000).toISOString(), timezone: "Asia/Shanghai" },
							payload: { kind: "command", command: [process.execPath, "-e", "process.stdout.write('cron argv')"] },
						},
					},
					ctx,
				)
			).text,
		);
		const outcome = JSON.parse((await tool.execute({ action: "run", id: created.id }, ctx)).text);
		assert.equal(outcome.status, "done", JSON.stringify(outcome));
		assert.equal(outcome.text, "cron argv");
		const script = join(data, "cron-script.mjs");
		await writeFile(script, "process.stdout.write(process.argv[2]);\n");
		const scripted = JSON.parse(
			(
				await tool.execute(
					{
						action: "create",
						job: {
							name: "Hosted cron script contract",
							enabled: false,
							schedule: { kind: "at", at: new Date(Date.now() + 3600000).toISOString(), timezone: "Asia/Shanghai" },
							payload: { kind: "script", interpreter: process.execPath, path: script, args: ["cron script argv"] },
						},
					},
					ctx,
				)
			).text,
		);
		const scriptOutcome = JSON.parse((await tool.execute({ action: "run", id: scripted.id }, ctx)).text);
		assert.equal(scriptOutcome.status, "done", JSON.stringify(scriptOutcome));
		assert.equal(scriptOutcome.text, "cron script argv");
		results.push({
			sdkAndCron: { owner, argv: true, string: true, permissions: true, command: outcome, script: scriptOutcome },
		});
	} finally {
		await kernel.close();
	}
}
if (mode === "contract") {
	const preaborted = new AbortController();
	preaborted.abort();
	assert.equal((await run("touch must-not-execute", {}, preaborted)).value.error.code, "aborted");
	await writeFile(join(home, "path-tool"), "#!/bin/sh\nprintf '%s' \"$1\"\n");
	await chmod(join(home, "path-tool"), 0o700);
	const pathTool = await run(["path-tool", "PATH argv literal"], { inheritEnv: false, env: { PATH: home } });
	assert.equal(succeeded(pathTool.value).exitCode, 0);
	assert.equal(pathTool.stdout, "PATH argv literal");
	const relativeTool = await run(["./path-tool", "relative argv"], { cwd: home });
	assert.equal(succeeded(relativeTool.value).exitCode, 0);
	assert.equal(relativeTool.stdout, "relative argv");
	const basic = await run("printf normal; printf error >&2; exit 7");
	assert.equal(succeeded(basic.value).exitCode, 7);
	assert.equal(basic.stdout, "normal");
	assert.equal(basic.stderr, "error");
	const literal = ["a b", "$(touch must-not-execute)", "'quoted'", "x;y"];
	const argv = await run([
		process.execPath,
		"-e",
		"process.stdout.write(JSON.stringify(process.argv.slice(1)))",
		...literal,
	]);
	assert.equal(succeeded(argv.value).exitCode, 0);
	assert.deepEqual(JSON.parse(argv.stdout), literal);
	const signalled = await run("kill -TERM $$");
	assert.equal(succeeded(signalled.value).exitCode, 143);
	const isolated = await run(
		[process.execPath, "-e", "process.stdout.write(JSON.stringify({cwd:process.cwd(),env:process.env}))"],
		{ inheritEnv: false, env: { ONLY: "provided" }, cwd: home },
	);
	const info = JSON.parse(isolated.stdout);
	assert.equal(info.cwd, await realpath(home));
	const baseline = JSON.parse(
		execFileSync(process.execPath, ["-e", "process.stdout.write(JSON.stringify(process.env))"], {
			env: { ONLY: "provided" },
			encoding: "utf8",
		}),
	);
	assert.deepEqual(info.env, baseline); // macOS Node itself adds __CF_USER_TEXT_ENCODING in either path.
	const piped = hostedProcessSpawner()({
		program: process.execPath,
		args: ["-"],
		cwd: home,
		env: process.env,
		stdin: "pipe",
	});
	let pipedOutput = "";
	piped.child.stdout.on("data", (chunk) => {
		pipedOutput += chunk;
	});
	piped.child.stdin.end("process.stdout.write('stdin transport')");
	assert.equal((await piped.result).code, 0);
	assert.equal(pipedOutput, "stdin transport");
	await writeFile(join(home, "grep-target.txt"), "real hosted rg needle\n");
	const grep = await createGrepTool().execute(
		{ pattern: "needle", path: join(home, "grep-target.txt") },
		{ env, signal: new AbortController().signal },
	);
	assert.equal(JSON.parse(grep.text).matches[0].text, "real hosted rg needle");
	const large = await run(
		[process.execPath, "-e", "process.stdout.write('x'.repeat(3*1024*1024));process.stderr.write('err-tail')"],
		{ spill: { afterBytes: 32, afterLines: 2 } },
	);
	assert.equal(succeeded(large.value).exitCode, 0);
	assert.equal(large.stdout.length, 3 * 1024 * 1024);
	assert.equal(large.stderr, "err-tail");
	const full = await readFile(large.value.value.spillPath, "utf8");
	assert.equal(full.replace("err-tail", ""), "x".repeat(3 * 1024 * 1024));
	const timeout = await run("trap '' TERM; while :; do sleep 1; done", { timeout: 0.1 });
	assert.equal(timeout.value.error.code, "timeout");
	const controller = new AbortController();
	const pending = run("trap '' TERM; echo $$ > victim.pid; while :; do sleep 1; done", {}, controller);
	await until(() =>
		access(join(home, "victim.pid")).then(
			() => true,
			() => false,
		),
	);
	controller.abort();
	assert.equal((await pending).value.error.code, "aborted");
	const cleaned = run("trap '' TERM; echo $$ > cleanup.pid; while :; do sleep 1; done");
	await until(() =>
		access(join(home, "cleanup.pid")).then(
			() => true,
			() => false,
		),
	);
	await env.cleanup(C);
	await cleaned;
	const callback = await run("echo callback; sleep 10", {
		onOutput() {
			throw new Error("output rejected");
		},
	});
	assert.equal(callback.value.error.code, "callback_error");
	const quick = await run([sameGroup, join(home, "descendant.pid")]);
	assert.equal(succeeded(quick.value).exitCode, 7);
	const child = Number(await readFile(join(home, "descendant.pid"), "utf8"));
	await until(() => {
		try {
			process.kill(child, 0);
			return false;
		} catch {
			return true;
		}
	});
	const db = await openDatabase(join(home, "runtime.db"));
	const config = { agent: null, profile: "default", cwd: home, resolved: resolveProfile({ level: "bypass" }) };
	const runtime = await Runtime.open({ home, db, config: { schema: 1 }, resolveSession: async () => config });
	try {
		assert.deepEqual(
			await runtime.executeCommand(config, {
				command: [
					process.execPath,
					"-e",
					"process.stdout.write('runtime argv');process.stderr.write('runtime error');process.exit(7)",
				],
			}),
			{ stdout: "runtime argv", stderr: "runtime error", exitCode: 7 },
		);
	} finally {
		await runtime.close();
		await db.close();
	}
	await kernelContracts();
	// Creating local env above and running bash here proves neither consumes fd4 twice.
	const bash = await processTool(home, new Map()).execute(
		{ command: "printf shared-capability" },
		{ taskId: 1001, env, output() {} },
		C,
	);
	assert.equal(JSON.parse(bash.output[0].text).output, "shared-capability");
	await assert.rejects(access(join(home, "must-not-execute")));
	await writeFile(join(home, "results.json"), JSON.stringify(results, null, 2));
} else if (mode.startsWith("gate")) {
	const controller = new AbortController();
	const timer = setInterval(() => {
		access(join(home, "abort")).then(
			() => controller.abort(),
			() => {},
		);
	}, 10);
	try {
		const value = await run("touch business-started", {}, controller);
		await writeFile(
			join(home, "gate-result.json"),
			JSON.stringify(value.value.ok ? { executed: true } : { error: value.value.error.message }),
		);
	} finally {
		clearInterval(timer);
	}
} else {
	await run([sameGroup, join(home, "descendant.pid"), ...(mode.startsWith("quick-") ? [] : ["hold"])]);
}
