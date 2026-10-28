import { spawn } from "node:child_process";

/** Private driver boundary. Callers supply fixed executables/argv, never shell source. */
export function runProcess(
	executable: string,
	argv: readonly string[],
	options: { signal?: AbortSignal; input?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number } = {},
): Promise<string> {
	options.signal?.throwIfAborted();
	return new Promise((resolve, reject) => {
		const child = spawn(executable, [...argv], {
			shell: false,
			detached: process.platform !== "win32",
			stdio: ["pipe", "pipe", "pipe"],
			env: options.env ?? process.env,
		});
		let stdout = "";
		let bytes = 0;
		let failure: Error | undefined;
		const stop = (error: Error) => {
			failure ??= error;
			if (child.pid) {
				try {
					// Linux SDK commands remain in this owned group; do not just kill an HTTP client.
					if (process.platform === "win32") child.kill("SIGKILL");
					else process.kill(-child.pid, "SIGKILL");
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code !== "ESRCH") failure = error as Error;
				}
			}
		};
		// A process forked concurrently with the group kill can join the owned group after that
		// single SIGKILL was delivered, so the group is re-signalled and drained before settling.
		const drainOwnedGroup = async (): Promise<void> => {
			if (process.platform === "win32" || !child.pid) return;
			const group = -child.pid;
			const deadline = Date.now() + 2_000;
			while (Date.now() < deadline) {
				try {
					process.kill(group, 0);
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code === "ESRCH") return;
				}
				try {
					process.kill(group, "SIGKILL");
				} catch {
					// The group vanished between the probe and the signal.
				}
				await new Promise((done) => setTimeout(done, 5));
			}
		};
		const abort = () => stop(new DOMException("Driver stopped after cancellation", "AbortError"));
		const timeout = setTimeout(() => stop(new Error("Driver timed out")), options.timeoutMs ?? 45_000);
		options.signal?.addEventListener("abort", abort, { once: true });
		if (options.signal?.aborted) abort();
		child.stdout.on("data", (chunk: Buffer) => {
			bytes += chunk.length;
			if (bytes > 2_000_000) stop(new Error("Driver output exceeds limit"));
			else stdout += chunk.toString("utf8");
		});
		// Drain diagnostic output, but never expose text input, screenshots or local credentials.
		child.stderr.resume();
		child.on("error", (error) => {
			failure ??= error;
		});
		child.stdin.on("error", () => {});
		child.stdin.end(options.input);
		child.on("close", (code) => {
			clearTimeout(timeout);
			options.signal?.removeEventListener("abort", abort);
			const reason = failure;
			if (reason) {
				// Do not settle an aborted action while the owned group it started is still alive.
				void drainOwnedGroup().then(() => reject(reason));
			} else if (code !== 0) reject(new Error(`Driver exited with code ${code}`));
			else resolve(stdout);
		});
	});
}
