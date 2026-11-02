import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { closeSync, openSync, writeSync } from "node:fs";
import { join } from "node:path";

const tailBytes = 128 * 1024;
export interface ProcessInput {
	command: string | string[];
	cwd: string;
	env?: Record<string, string>;
	timeout?: number;
}

/** Command execution is an explicitly granted shell capability, not a filesystem sandbox. */
export async function executeHostProcess(input: ProcessInput, signal: AbortSignal) {
	signal.throwIfAborted();
	return new Promise<{ exitCode: number; stdout: string; stderr: string; spillPath?: string }>((resolve, reject) => {
		const argv = Array.isArray(input.command) ? input.command.slice(1) : [];
		const executable = Array.isArray(input.command) ? input.command[0]! : input.command;
		const child = spawn(executable, argv, {
			cwd: input.cwd,
			env: { ...process.env, ...input.env },
			shell: typeof input.command === "string",
			detached: process.platform !== "win32",
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = Buffer.alloc(0),
			stderr = Buffer.alloc(0);
		let spill: number | undefined, spillPath: string | undefined;
		let failure: Error | undefined;
		let killed: Promise<void> | undefined;
		const kill = () => {
			if (!child.pid) return Promise.resolve();
			if (process.platform === "win32")
				return new Promise<void>((done, failed) => {
					const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
						windowsHide: true,
						stdio: "ignore",
					});
					killer.on("error", failed);
					killer.on("close", (code) =>
						code === 0 ? done() : failed(new Error("Could not confirm process tree cancellation")),
					);
				});
			try {
				process.kill(-child.pid, "SIGKILL");
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ESRCH") return Promise.reject(error);
			}
			return Promise.resolve();
		};
		const stop = (error: Error) => {
			failure ??= error;
			killed ??= kill();
			void killed.catch(() => {});
		};
		const abort = () => stop(new DOMException("Process cancelled", "AbortError"));
		const timer =
			input.timeout === undefined
				? undefined
				: setTimeout(() => stop(Object.assign(new Error("Process timed out"), { code: "ETIMEDOUT" })), input.timeout);
		signal.addEventListener("abort", abort, { once: true });
		if (signal.aborted) abort();
		const collect = (stream: "stdout" | "stderr", chunk: Buffer) => {
			try {
				if (spill === undefined && stdout.length + stderr.length + chunk.length > tailBytes * 2) {
					spillPath = join(input.cwd, `.yonder-output-${randomUUID()}.log`);
					spill = openSync(spillPath, "wx", 0o600);
					writeSync(spill, Buffer.concat([Buffer.from("[stdout]\n"), stdout, Buffer.from("\n[stderr]\n"), stderr]));
				}
				if (spill !== undefined) {
					writeSync(spill, `\n[${stream}]\n`);
					writeSync(spill, chunk);
				}
				if (stream === "stdout") stdout = Buffer.concat([stdout, chunk]);
				else stderr = Buffer.concat([stderr, chunk]);
				if (spill !== undefined) {
					stdout = stdout.subarray(-tailBytes);
					stderr = stderr.subarray(-tailBytes);
				}
			} catch (error) {
				stop(error as Error);
			}
		};
		child.stdout.on("data", (chunk: Buffer) => collect("stdout", chunk));
		child.stderr.on("data", (chunk: Buffer) => collect("stderr", chunk));
		child.on("error", (error) => {
			failure ??= error;
		});
		child.on("close", (code) => {
			if (timer) clearTimeout(timer);
			signal.removeEventListener("abort", abort);
			void (async () => {
				try {
					if (spill !== undefined) closeSync(spill);
					if (killed) {
						await killed;
						if (process.platform !== "win32" && child.pid) {
							// Re-signal any descendants forked concurrently with the first group kill.
							const deadline = Date.now() + 2000;
							for (;;) {
								try {
									process.kill(-child.pid, 0);
								} catch (error) {
									if ((error as NodeJS.ErrnoException).code === "ESRCH") break;
									throw error;
								}
								if (Date.now() >= deadline) throw new Error("Could not confirm process group cancellation");
								try {
									process.kill(-child.pid, "SIGKILL");
								} catch (error) {
									if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
								}
								await new Promise((done) => setTimeout(done, 10));
							}
						}
					}
					if (failure) throw failure;
					resolve({
						exitCode: code ?? -1,
						stdout: stdout.toString("utf8"),
						stderr: stderr.toString("utf8"),
						...(spillPath ? { spillPath } : {}),
					});
				} catch (error) {
					reject(error);
				}
			})();
		});
	});
}
