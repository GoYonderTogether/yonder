import { spawn } from "node:child_process";
import { closeSync, fstatSync, readSync } from "node:fs";
import { mkdir, open } from "node:fs/promises";
import type { Socket } from "node:net";
import { constants } from "node:os";
import { isAbsolute, join } from "node:path";
import type { ToolRegistration } from "@earendil-works/pi-durable";
import { Type } from "typebox";

// The host supplies a one-shot private fd, never a user-configurable executable
// setting. A hosted process with a missing/broken capability must fail closed.
let commandHost: { helper: string; registration: string } | undefined;
let commandHostFailure: unknown;
function hostedCommand() {
	if (process.platform !== "darwin") return undefined;
	if (commandHost) return commandHost;
	if (commandHostFailure) throw commandHostFailure;
	if (!process.env.YONDER_SERVICE_REGISTRATION && !process.env.YONDER_SERVICE_COMMAND_FD) return undefined;
	let opened = false;
	try {
		if (process.env.YONDER_SERVICE_COMMAND_FD !== "4" || !fstatSync(4).isSocket())
			throw new Error("Service command capability is missing or invalid");
		opened = true;
		const buffer = Buffer.alloc(16384);
		let size = 0;
		while (size < buffer.length) {
			const count = readSync(4, buffer, size, buffer.length - size, null);
			if (!count) break;
			size += count;
		}
		if (size === buffer.length) throw new Error("Service command capability exceeds limit");
		const value = JSON.parse(buffer.subarray(0, size).toString());
		if (
			typeof value.helper !== "string" ||
			!isAbsolute(value.helper) ||
			value.registration !== process.env.YONDER_SERVICE_REGISTRATION
		)
			throw new Error("Service command capability does not match the host");
		commandHost = value;
		return commandHost;
	} catch (error) {
		commandHostFailure = error;
		throw error;
	} finally {
		if (opened) closeSync(4);
	}
}

export function processTool(
	home: string,
	jobs: Map<number, { output: string; write?: (text: string, eof?: boolean) => Promise<void> }>,
): ToolRegistration {
	return {
		name: "bash",
		deferred: true,
		description:
			"Run a shell command in the execution workspace. Calls lasting 15 seconds return a background id automatically; background=true yields immediately. Use process for logs, stdin, status or cancellation. timeout is a soft elapsed-time reminder, not a kill limit. Output is bounded; full stdout/stderr is retained in the reported log file. For builds, installs and long scripts, use background=true and continue independent work; completion arrives automatically. Keep the actual handle for a development server or watcher, and stop it when no longer needed. Set cwd to the intended repository; do not confuse this process with a child Agent. Do not use shell detachment to escape lifecycle ownership. Stdin is closed by default; set stdin=true only for commands that need process.write, then finish input with eof=true. Shell pipelines are supported; this is not a PTY. Specify a search path when searching files.",
		parameters: Type.Object(
			{
				command: Type.String(),
				cwd: Type.Optional(Type.String()),
				background: Type.Optional(Type.Boolean()),
				stdin: Type.Optional(Type.Boolean()),
				timeout: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
			},
			{ additionalProperties: false },
		),
		async execute(value, api, context) {
			const args = value as { command: string; cwd?: string; timeout?: number; stdin?: boolean };
			if (api.env?.id !== "node:local")
				throw new Error("Interactive process management requires the local environment");
			const folder = join(home, ".yonder", "background");
			await mkdir(folder, { recursive: true, mode: 0o700 });
			const path = join(folder, `${api.taskId}.log`),
				log = await open(path, "a", 0o600);
			try {
				const host = hostedCommand();
				return await new Promise((resolve, reject) => {
					const child = spawn(
						host?.helper ?? "/bin/bash",
						host ? ["service-command-anchor", args.command] : ["-c", args.command],
						{
							cwd: args.cwd ?? api.env!.cwd,
							detached: !host,
							stdio: host
								? [args.stdin ? "pipe" : "ignore", "pipe", "pipe", "pipe"]
								: [args.stdin ? "pipe" : "ignore", "pipe", "pipe"],
						},
					);
					const control = host ? (child.stdio[3] as Socket) : undefined;
					let result: { exitCode: number | null; signal: NodeJS.Signals | null } | undefined;
					let protocol = "";
					control?.setEncoding("utf8");
					control?.on("data", (chunk: string) => {
						try {
							protocol += chunk;
							if (protocol.length > 16384) throw new Error("Command result exceeds limit");
							let end = protocol.indexOf("\n");
							while (end >= 0) {
								const frame = JSON.parse(protocol.slice(0, end));
								protocol = protocol.slice(end + 1);
								if ("exitCode" in frame) {
									const signal =
										frame.signal === null
											? null
											: (Object.entries(constants.signals).find(([, value]) => value === frame.signal)?.[0] as
													| NodeJS.Signals
													| undefined);
									if (
										result ||
										!(frame.exitCode === null || Number.isInteger(frame.exitCode)) ||
										signal === undefined ||
										(frame.exitCode === null) === (signal === null)
									)
										throw new Error("Invalid command result");
									result = { exitCode: frame.exitCode, signal };
								}
								end = protocol.indexOf("\n");
							}
						} catch (error) {
							fault = error;
							control.end();
						}
					});
					control?.on("error", (error) => {
						fault = error;
					});
					let output = "",
						stderr = "",
						writes = Promise.resolve(),
						fault: unknown;
					let pendingWrites = 0;
					const append = (text: string, error = false) => {
						output = (output + text).slice(-65536);
						if (error) stderr = (stderr + text).slice(-65536);
						api.output(text);
						child.stdout!.pause();
						child.stderr!.pause();
						pendingWrites++;
						writes = writes
							.then(() => log.write(text))
							.then(() => {})
							.catch((error) => {
								fault = error;
								stop();
							})
							.finally(() => {
								if (--pendingWrites === 0) {
									child.stdout!.resume();
									child.stderr!.resume();
								}
							});
					};
					const stop = () => {
						if (control) {
							control.end();
							return;
						}
						if (child.pid) {
							try {
								process.kill(-child.pid, "SIGTERM");
							} catch (error) {
								if ((error as NodeJS.ErrnoException).code !== "ESRCH") fault = error;
							}
						}
					};
					const force = () => {
						// Native gate owns TERM -> 1s KILL, including ACK-before-start.
						// Never signal the original service group from Node.
						if (host) return;
						if (child.pid) {
							try {
								process.kill(-child.pid, "SIGKILL");
							} catch (error) {
								if ((error as NodeJS.ErrnoException).code !== "ESRCH") fault = error;
							}
						}
					};
					let escalation: ReturnType<typeof setTimeout> | undefined;
					const abort = () => {
						stop();
						escalation = setTimeout(force, 1000);
						escalation.unref();
					};
					const timer = args.timeout
						? setTimeout(() => append(`\n[elapsed ${args.timeout}s; still running]\n`), args.timeout * 1000)
						: undefined;
					timer?.unref();
					const job = jobs.get(api.taskId);
					if (job && child.stdin)
						job.write = async (text, eof) => {
							const input = child.stdin!;
							await new Promise<void>((done, fail) => input.write(text, (error) => (error ? fail(error) : done())));
							if (eof) {
								input.end();
								delete job.write;
							}
						};
					child.stdout!.setEncoding("utf8").on("data", (text: string) => append(text));
					child.stderr!.setEncoding("utf8").on("data", (text: string) => append(text, true));
					child.stdin?.on("error", () => {});
					child.once("error", (error) => {
						fault = error;
					});
					child.once("close", async (code, signal) => {
						clearTimeout(timer);
						clearTimeout(escalation);
						context.abortSignal?.removeEventListener("abort", abort);
						if (job) delete job.write;
						await writes;
						if (fault) reject(fault);
						else if (context.abortSignal?.aborted) reject(context.abortSignal.reason);
						else if (host && !result)
							reject(new Error(`Hosted command exited without a verified result (${code}, ${signal})`));
						else
							resolve({
								output: [
									{
										type: "text",
										text: JSON.stringify({
											output,
											stderr,
											exitCode: host ? result!.exitCode : code,
											signal: host ? result!.signal : signal,
											fullOutputPath: path,
										}),
									},
								],
								isError: (host ? result!.exitCode : code) !== 0,
								details: { pid: child.pid ?? 0, fullOutputPath: path },
							});
					});
					if (context.abortSignal?.aborted) abort();
					else context.abortSignal?.addEventListener("abort", abort, { once: true });
				});
			} finally {
				await log.close();
			}
		},
	};
}
