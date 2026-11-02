import { spawn } from "node:child_process";

interface CommandResult {
	code: number;
	stdout: string;
	stderr: string;
}
export function command(
	program: string,
	args: string[],
	options: { cwd?: string; env?: NodeJS.ProcessEnv; allowFailure?: boolean } = {},
): Promise<CommandResult> {
	return new Promise((resolve, reject) => {
		const child = spawn(program, args, {
			cwd: options.cwd,
			env: options.env ?? process.env,
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "",
			stderr = "";
		child.stdout.on("data", (chunk) => {
			stdout += chunk;
		});
		child.stderr.on("data", (chunk) => {
			stderr += chunk;
		});
		child.once("error", reject);
		child.once("close", (code) => {
			const result = { code: code ?? 1, stdout, stderr };
			if (result.code && !options.allowFailure)
				reject(new Error(`${program} failed (${result.code}): ${stderr.trim() || stdout.trim()}`));
			else resolve(result);
		});
	});
}
