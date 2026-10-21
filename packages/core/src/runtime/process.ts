import { spawn } from "node:child_process";
import { mkdir, open } from "node:fs/promises";
import { join } from "node:path";
import type { ToolExecutionApi, ToolRegistration } from "@earendil-works/pi-durable";
import { Type } from "typebox";

export function processTool(
	home: string,
	jobs: Map<number, { output: string; write?: (text: string) => Promise<void> }>,
): ToolRegistration {
	return {
		name: "bash",
		deferred: true,
		description:
			"Run a shell command in the execution workspace. Calls lasting 15 seconds return a background id automatically; background=true yields immediately. Use process for logs, stdin, status or cancellation. timeout is a soft elapsed-time reminder, not a kill limit. Output is bounded; full stdout/stderr is retained in the reported log file. Pipes are supported; this is not a PTY.",
		parameters: Type.Object(
			{
				command: Type.String(),
				cwd: Type.Optional(Type.String()),
				background: Type.Optional(Type.Boolean()),
				timeout: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
			},
			{ additionalProperties: false },
		),
		async execute(value, api, context) {
			const args = value as { command: string; cwd?: string; timeout?: number };
			if (api.env?.id !== "node:local")
				throw new Error("Interactive process management requires the local environment");
			const folder = join(home, ".yonder", "background");
			await mkdir(folder, { recursive: true, mode: 0o700 });
			const path = join(folder, `${api.taskId}.log`),
				log = await open(path, "a", 0o600);
			try {
				return await new Promise((resolve, reject) => {
					const child = spawn("/bin/bash", ["-c", args.command], {
						cwd: args.cwd ?? api.env!.cwd,
						detached: true,
						stdio: ["pipe", "pipe", "pipe"],
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
						child.stdout.pause();
						child.stderr.pause();
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
									child.stdout.resume();
									child.stderr.resume();
								}
							});
					};
					const stop = () => {
						if (child.pid) {
							try {
								process.kill(-child.pid, "SIGTERM");
							} catch (error) {
								if ((error as NodeJS.ErrnoException).code !== "ESRCH") fault = error;
							}
						}
					};
					const force = () => {
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
					if (job)
						job.write = (text) =>
							new Promise<void>((done, fail) => child.stdin.write(text, (error) => (error ? fail(error) : done())));
					child.stdout.setEncoding("utf8").on("data", (text: string) => append(text));
					child.stderr.setEncoding("utf8").on("data", (text: string) => append(text, true));
					child.stdin.on("error", () => {});
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
						else
							resolve({
								output: [
									{
										type: "text",
										text: JSON.stringify({ output, stderr, exitCode: code, signal, fullOutputPath: path }),
									},
								],
								isError: code !== 0,
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
