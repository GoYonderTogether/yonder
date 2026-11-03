import { execFile, spawn } from "node:child_process";
import { join } from "node:path";
import type { LocalProcessSpawn } from "@earendil-works/pi-durable/env/node";

/** Keep native stream handling; report completion at child close, not at exit. */
export const windowsProcessSpawn: LocalProcessSpawn = ({ program, args, cwd, env, stdin }) => {
	const child = spawn(program, args, { cwd, env, stdio: [stdin, "pipe", "pipe"], windowsHide: true });
	let fault: Error | undefined;
	let cancelled = false;
	const result = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
		child.once("error", (error) => {
			fault = error;
		});
		child.once("close", (code, signal) => (fault ? reject(fault) : resolve({ code, signal })));
	});
	const cancel = () => {
		if (cancelled || !child.pid || child.exitCode !== null || child.signalCode !== null) return;
		cancelled = true;
		execFile(
			join(process.env.SystemRoot ?? "C:\\Windows", "System32", "taskkill.exe"),
			["/F", "/T", "/PID", String(child.pid)],
			{ windowsHide: true, timeout: 5_000 },
			(error) => {
				if (error && child.exitCode === null && child.signalCode === null) {
					fault = error;
					child.kill("SIGKILL");
				}
			},
		);
	};
	return { child, cancel, result };
};
