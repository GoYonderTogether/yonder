import { type ChildProcess, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
export const children = new Map<ChildProcess, string>();
/** Cleanup deadline only: ordinary native calls have no forced duration limit. */
export async function stopChildren(owner?: string): Promise<void> {
	await Promise.all(
		[...children]
			.filter(([, session]) => owner === undefined || session === owner)
			.map(
				([child]) =>
					new Promise<void>((resolve) => {
						if (!children.has(child)) {
							resolve();
							return;
						}
						const force = setTimeout(() => child.kill("SIGKILL"), 1000);
						force.unref();
						child.once("close", () => {
							clearTimeout(force);
							resolve();
						});
						child.kill("SIGTERM");
					}),
			),
	);
}
export function native(
	command: string,
	args: string[],
	signal: AbortSignal,
	owner: string,
	input?: string,
): Promise<string> {
	signal.throwIfAborted();
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, { signal, stdio: ["pipe", "pipe", "pipe"] });
		children.set(child, owner);
		child.stdin.on("error", () => {});
		child.stdin.end(input);
		let stdout = "",
			stderr = "",
			overflow = false;
		child.stdout.on("data", (data) => {
			stdout += String(data);
			if (stdout.length > 1000000) {
				overflow = true;
				child.kill();
			}
		});
		child.stderr.on("data", (data) => {
			stderr = (stderr + String(data)).slice(-10000);
		});
		child.on("error", reject);
		child.on("close", (code) => {
			children.delete(child);
			if (code !== 0 || overflow)
				reject(new Error(`${command} failed (${code}): ${overflow ? "output exceeded 1MB" : stderr}`));
			else resolve(stdout.trim());
		});
	});
}
export async function desktop(args: Record<string, unknown>, signal: AbortSignal, owner: string): Promise<unknown> {
	if (process.platform !== "darwin")
		throw new Error("Native desktop requires macOS; no Linux/Windows driver installed");
	return JSON.parse(
		await native(
			process.execPath,
			[fileURLToPath(new URL("../../../scripts/yonder-permissions.mjs", import.meta.url)), "rpc"],
			signal,
			owner,
			JSON.stringify(args),
		),
	);
}
