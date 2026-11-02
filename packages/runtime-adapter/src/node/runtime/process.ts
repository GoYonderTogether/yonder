import { execFile, spawn } from "node:child_process";
import { access, mkdir, open, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ToolRegistration } from "@earendil-works/pi-durable";
import { getOrThrow } from "@earendil-works/pi-durable/env";
import type { RuntimeSessionConfig } from "@yonder/runtime-adapter/types";
import { Type } from "typebox";
import { hostedProcessSpawner } from "./hosted-process.js";
import { cacheToolOutput } from "./tool-output-cache.js";

export const inspectContextEnv = "YONDER_RUNTIME_INSPECT_CONTEXT";

// Keep the bash contract on Windows; cmd.exe cannot interpret the same commands.
async function bashPath() {
	if (process.platform !== "win32") return "/bin/bash";
	const candidates = [process.env.ProgramFiles, process.env["ProgramFiles(x86)"]]
		.filter((path): path is string => Boolean(path))
		.map((path) => join(path, "Git", "bin", "bash.exe"));
	for (const candidate of candidates) {
		try {
			await access(candidate);
			return candidate;
		} catch {}
	}
	const onPath = await new Promise<string>((resolve) => {
		execFile("where.exe", ["bash.exe"], { windowsHide: true, timeout: 5000 }, (_error, stdout) =>
			resolve(stdout ?? ""),
		);
	});
	for (const candidate of onPath.trim().split(/\r?\n/).filter(Boolean)) {
		// WSL's launcher has different cwd/stdin/PID semantics, not a local Bash process.
		if (/^[a-z]:\\windows\\(?:system32|sysnative)\\bash\.exe$/i.test(candidate.replaceAll("/", "\\"))) continue;
		try {
			await access(candidate);
			return candidate;
		} catch {}
	}
	throw new Error("No local bash shell found. Install Git for Windows or add Git Bash/MSYS2 bash.exe to PATH.");
}

export function processTool(
	home: string,
	jobs: Map<number, { output: string; write?: (text: string, eof?: boolean) => Promise<void> }>,
	resolveSession?: (id: string) => Promise<RuntimeSessionConfig>,
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
			if (api.env?.id.startsWith("device:")) {
				if (args.stdin) throw new Error("Remote commands do not support interactive stdin");
				let output = "";
				const timer = args.timeout
					? setTimeout(() => api.output(`\n[elapsed ${args.timeout}s; still running]\n`), args.timeout * 1000)
					: undefined;
				try {
					const result = getOrThrow(
						await api.env.exec(
							args.command,
							{
								...(args.cwd ? { cwd: args.cwd } : {}),
								onOutput: (text) => {
									output = (output + text).slice(-65536);
									api.output(text);
								},
							},
							context,
						),
					);
					return {
						output: [
							{
								type: "text",
								text: JSON.stringify({
									output,
									exitCode: result.exitCode,
									...(result.spillPath ? { log: result.spillPath } : {}),
								}),
							},
						],
						isError: result.exitCode !== 0,
					};
				} finally {
					clearTimeout(timer);
				}
			}
			if (api.env?.id !== "node:local")
				throw new Error("Interactive process management requires the local environment");
			const session = await resolveSession?.(String(api.conversationId));
			const childEnv = { ...process.env };
			delete childEnv[inspectContextEnv];
			if (session?.agent && session.profile)
				childEnv[inspectContextEnv] = JSON.stringify({ home, agent: session.agent, profile: session.profile });
			const folder = join(home, ".yonder", "background");
			await mkdir(folder, { recursive: true, mode: 0o700 });
			const path = join(folder, `${api.taskId}.log`),
				log = await open(path, "a", 0o600);
			try {
				const host = hostedProcessSpawner();
				const shell = await bashPath();
				return await new Promise((resolve, reject) => {
					const hosted = host?.({
						program: shell,
						args: ["-c", args.command],
						cwd: args.cwd ?? api.env!.cwd,
						env: childEnv,
						stdin: args.stdin ? "pipe" : "ignore",
					});
					const child =
						hosted?.child ??
						spawn(shell, ["-c", args.command], {
							cwd: args.cwd ?? api.env!.cwd,
							env: childEnv,
							detached: process.platform !== "win32",
							windowsHide: true,
							stdio: [args.stdin ? "pipe" : "ignore", "pipe", "pipe"],
						});
					let result: { code: number | null; signal: NodeJS.Signals | null } | undefined;
					let completionFault: unknown;
					const completed = hosted?.result.then(
						(value) => {
							result = value;
						},
						(error) => {
							completionFault = error;
						},
					);
					let total = 0,
						lines = 1,
						output = "",
						stderr = "",
						writes = Promise.resolve(),
						fault: unknown;
					let pendingWrites = 0;
					const append = (text: string, error = false) => {
						total += Buffer.byteLength(text);
						lines += (text.match(/\n/g) ?? []).length;
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
						if (hosted) {
							hosted.cancel();
							return;
						}
						if (child.pid && process.platform === "win32") {
							execFile(
								join(process.env.SystemRoot ?? "C:\\Windows", "System32", "taskkill.exe"),
								["/F", "/T", "/PID", String(child.pid)],
								{ windowsHide: true },
								(error) => {
									if (error && child.exitCode === null && child.signalCode === null) fault = error;
								},
							);
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
						if (host || process.platform === "win32") return;
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
						await completed;
						if (fault) reject(fault);
						else if (context.abortSignal?.aborted) reject(context.abortSignal.reason);
						else if (completionFault) reject(completionFault);
						else if (host && !result)
							reject(new Error(`Hosted command exited without a verified result (${code}, ${signal})`));
						else {
							let cached: string | undefined;
							let cacheFailed = false;
							try {
								if (total > 48 * 1024 || lines > 1990)
									cached = await cacheToolOutput(
										home,
										String(api.conversationId),
										"bash",
										args,
										await readFile(path, "utf8"),
									);
							} catch {
								cacheFailed = true;
							}
							resolve({
								output: [
									{
										type: "text",
										text: JSON.stringify({
											...(cacheFailed ? { cache: "Cache unavailable." } : {}),
											...(cached
												? {
														cache: `${cached}; lines 1-${Math.max(1, lines - (output.endsWith("\n") ? 1 : 0))}; use read to paginate or grep to search`,
													}
												: {}),
											output,
											stderr,
											exitCode: host ? result!.code : code,
											signal: host ? result!.signal : signal,
											fullOutputPath: path,
										}),
									},
								],
								isError: (host ? result!.code : code) !== 0,
								details: { pid: child.pid ?? 0, fullOutputPath: path },
							});
						}
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
