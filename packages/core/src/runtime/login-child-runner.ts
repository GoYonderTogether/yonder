import { type ChildProcess, spawn as nodeSpawn } from "node:child_process";
import type { LoginOutcome } from "./login-operations.js";

export interface LoginTerminalChild {
	on(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
	on(event: "error", listener: (error: Error) => void): this;
	kill(signal?: NodeJS.Signals): boolean;
}
export type SpawnTerminal = (
	command: string,
	args: string[],
	options: { cwd: string; env: NodeJS.ProcessEnv; stdio: "inherit" | "ignore" },
) => LoginTerminalChild;
export interface LoginChildRunnerOptions {
	home: string;
	providers: ReadonlyMap<string, { command: string; args?: string[] }>;
	spawnTerminal?: SpawnTerminal;
	timeoutMs?: number;
}
export interface LoginChildInput {
	id: string;
	capability: string;
	provider: string;
	finish(outcome: LoginOutcome, code: number): Promise<boolean>;
}

/** Private host-side runner. start() acknowledges launch immediately; completion finishes the durable operation asynchronously. */
export function createLoginChildRunner(options: LoginChildRunnerOptions) {
	const spawnTerminal =
		options.spawnTerminal ??
		((command, args, launch) => {
			if (!process.stdin.isTTY || !process.stdout.isTTY || !process.stderr.isTTY)
				throw new Error("Login requires an interactive terminal");
			return nodeSpawn(command, args, launch) as ChildProcess;
		});
	const active = new Map<string, (outcome: LoginOutcome) => void>();
	return {
		cancel(id: string) {
			active.get(id)?.("cancelled");
		},
		start(input: LoginChildInput): Promise<void> {
			const provider = options.providers.get(input.provider);
			if (!provider) throw new Error("Unsupported login provider");
			const child = spawnTerminal(provider.command, [...(provider.args ?? [])], {
				cwd: options.home,
				env: { ...process.env, YONDER_HOME: options.home },
				stdio: "inherit",
			});
			let settled = false;
			let timer: ReturnType<typeof setTimeout> | undefined;
			const settle = (outcome: LoginOutcome, code: number) => {
				if (settled) return;
				settled = true;
				active.delete(input.id);
				if (timer) clearTimeout(timer);
				void input.finish(outcome, code).catch(() => undefined);
			};
			active.set(input.id, (outcome) => {
				child.kill("SIGTERM");
				settle(outcome, 130);
			});
			child.on("exit", (code, signal) =>
				settle(signal ? "interrupted" : code === 0 ? "succeeded" : "failed", code ?? 1),
			);
			child.on("error", () => settle("failed", 1));
			timer = setTimeout(
				() => {
					child.kill("SIGTERM");
					settle("failed", 124);
				},
				options.timeoutMs ?? 10 * 60_000,
			);
			timer.unref?.();
			return Promise.resolve();
		},
	};
}
