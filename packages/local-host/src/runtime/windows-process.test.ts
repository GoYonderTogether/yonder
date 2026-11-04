import { type ChildProcess, execFile, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { windowsProcessSpawn } from "@yonder/runtime-adapter/node/runtime/windows-process";
import { tempHome } from "@yonder/sdk/testing";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

vi.mock("node:child_process", async (original) => {
	const actual = await original<typeof import("node:child_process")>();
	return { ...actual, spawn: vi.fn(actual.spawn), execFile: vi.fn(actual.execFile) };
});
const native = await vi.importActual<typeof import("node:child_process")>("node:child_process");
const homes: string[] = [];
beforeEach(() => {
	vi.mocked(spawn).mockReset().mockImplementation(native.spawn);
	vi.mocked(execFile).mockReset().mockImplementation(native.execFile);
});
afterEach(async () => {
	vi.unstubAllEnvs();
	for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true });
});
function childFixture() {
	return Object.assign(new EventEmitter(), {
		pid: 123,
		exitCode: null as number | null,
		signalCode: null as NodeJS.Signals | null,
		stdin: new PassThrough(),
		stdout: new PassThrough(),
		stderr: new PassThrough(),
		kill: vi.fn(() => true),
	}) as unknown as ChildProcess;
}
const request = {
	program: "node",
	args: ["literal & value"],
	cwd: process.cwd(),
	env: { PATH: "isolated" },
	stdin: "pipe" as const,
};

test("result waits for close, not exit or error, and forwards the literal spawn request", async () => {
	const child = childFixture();
	vi.mocked(spawn).mockReturnValue(child as never);
	const started = windowsProcessSpawn(request);
	expect(spawn).toHaveBeenCalledWith(request.program, request.args, {
		cwd: request.cwd,
		env: request.env,
		stdio: ["pipe", "pipe", "pipe"],
		windowsHide: true,
	});
	let settled = false;
	void started.result.then(() => {
		settled = true;
	});
	child.emit("exit", 7, null);
	await Promise.resolve();
	expect(settled).toBe(false);
	child.emit("close", 7, null);
	await expect(started.result).resolves.toEqual({ code: 7, signal: null });
	const failed = windowsProcessSpawn(request);
	const error = Object.assign(new Error("cannot spawn"), { code: "ENOENT" });
	let rejected = false;
	void failed.result.catch(() => {
		rejected = true;
	});
	child.emit("error", error);
	await Promise.resolve();
	expect(rejected).toBe(false);
	child.emit("close", -2, null);
	await expect(failed.result).rejects.toBe(error);
});

test.each([false, true])("cancellation is bounded and preserves failure attribution (timeout=%s)", async (timeout) => {
	const child = childFixture();
	vi.mocked(spawn).mockReturnValue(child as never);
	vi.stubEnv("SystemRoot", undefined);
	const fault = Object.assign(
		new Error(timeout ? "taskkill timed out" : "taskkill failed"),
		timeout ? { killed: true, signal: "SIGTERM" } : {},
	);
	vi.mocked(execFile).mockImplementation((...args: unknown[]) => {
		(args.at(-1) as (error: Error) => void)(fault);
		return child;
	});
	const started = windowsProcessSpawn(request);
	started.cancel();
	started.cancel();
	expect(execFile).toHaveBeenCalledTimes(1);
	expect(execFile).toHaveBeenCalledWith(
		join("C:\\Windows", "System32", "taskkill.exe"),
		["/F", "/T", "/PID", "123"],
		{ windowsHide: true, timeout: 5_000 },
		expect.any(Function),
	);
	expect(child.kill).toHaveBeenCalledWith("SIGKILL");
	child.emit("close", 1, null);
	await expect(started.result).rejects.toBe(fault);
});

test("the existing env still drains output and closes inherited pipes after its exit grace", async () => {
	const child = childFixture();
	let closed = 0;
	for (const stream of [child.stdout!, child.stderr!])
		stream.once("close", () => {
			if (++closed === 2) child.emit("close", 0, null);
		});
	vi.mocked(spawn).mockImplementation(() => {
		queueMicrotask(() => {
			child.stdout!.emit("data", Buffer.from("original output"));
			child.emit("exit", 0, null); // inherited writers do not end either pipe
		});
		return child as never;
	});
	const env = new NodeExecutionEnv({ cwd: process.cwd(), localSpawn: windowsProcessSpawn });
	let output = "";
	const result = await env.exec(
		["node", "literal"],
		{
			onOutput: (chunk) => {
				output += chunk;
			},
		},
		BACKGROUND_CONTEXT,
	);
	expect(result).toEqual({ ok: true, value: { exitCode: 0 } });
	expect(output).toBe("original output");
	expect(closed).toBe(2);
});

test("real Node stdin, output and nonzero result are retained through close; spawn failure settles", async () => {
	const home = await tempHome("windows-close-");
	homes.push(home);
	const started = windowsProcessSpawn({
		program: process.execPath,
		args: [
			"-e",
			"process.stdin.on('data', x => process.stdout.write(x));process.stdin.on('end', () => {process.stderr.write(process.env.CLOSE_CHECK);process.exitCode=7;});",
		],
		cwd: home,
		env: { ...process.env, CLOSE_CHECK: "stderr value" },
		stdin: "pipe",
	});
	let stdout = "",
		stderr = "";
	started.child.stdout!.on("data", (chunk) => {
		stdout += chunk;
	});
	started.child.stderr!.on("data", (chunk) => {
		stderr += chunk;
	});
	started.child.stdin!.end("literal & input");
	await expect(started.result).resolves.toEqual({ code: 7, signal: null });
	expect(stdout).toBe("literal & input");
	expect(stderr).toBe("stderr value");
	const failed = windowsProcessSpawn({ ...request, program: join(home, "missing-program"), cwd: home });
	await expect(failed.result).rejects.toMatchObject({ code: "ENOENT" });
});

test.skipIf(process.platform !== "win32")("Windows cancellation closes a real Node process and its child", async () => {
	const home = await tempHome("windows-tree-");
	homes.push(home);
	const started = windowsProcessSpawn({
		program: process.execPath,
		args: [
			"-e",
			"const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'inherit'});console.log(JSON.stringify({parent:process.pid,child:child.pid}));setInterval(()=>{},1000);",
		],
		cwd: home,
		env: process.env,
		stdin: "ignore",
	});
	try {
		const pids = await new Promise<{ parent: number; child: number }>((resolve, reject) => {
			let text = "";
			started.child.stdout!.on("data", (chunk) => {
				text += chunk;
				if (text.includes("\n")) resolve(JSON.parse(text.trim()));
			});
			void started.result.then(() => reject(new Error("fixture exited before readiness")), reject);
		});
		started.cancel();
		await started.result;
		for (const pid of Object.values(pids))
			await expect(Promise.resolve().then(() => process.kill(pid, 0))).rejects.toMatchObject({ code: "ESRCH" });
	} finally {
		started.cancel();
		await started.result;
	}
});
