import { spawn } from "node:child_process";
import { expect, test, vi } from "vitest";
import { createLoginChildRunner } from "./login-child-runner.js";

const fixture = (
	command: string,
	args: string[],
	_options: { cwd: string; env: NodeJS.ProcessEnv; stdio: "inherit" | "ignore" },
) => spawn(command, args, { stdio: "ignore" });

test("private child runner maps real child exit once and never returns child output or capability", async () => {
	const finishes: unknown[][] = [];
	const runner = createLoginChildRunner({
		home: process.cwd(),
		providers: new Map([
			[
				"fixture",
				{ command: process.execPath, args: ["-e", "process.stdout.write('synthetic-secret'); process.exit(0)"] },
			],
		]),
		spawnTerminal: fixture,
	});
	await runner.start({
		id: "operation",
		capability: "host-only-capability",
		provider: "fixture",
		finish: async (...args) => {
			finishes.push(args);
			return true;
		},
	});
	await vi.waitFor(() => expect(finishes).toEqual([["succeeded", 0]]));
	expect(JSON.stringify(finishes)).not.toContain("synthetic-secret");
	expect(JSON.stringify(finishes)).not.toContain("host-only-capability");
});

test("timeout and owner cancellation win exit races and finish once", async () => {
	for (const mode of ["timeout", "cancel"] as const) {
		const finishes: unknown[][] = [];
		let exit!: (code: number | null, signal: NodeJS.Signals | null) => void;
		let killed = false;
		const runner = createLoginChildRunner({
			home: ".",
			providers: new Map([["fixture", { command: "fixture" }]]),
			timeoutMs: mode === "timeout" ? 5 : 60_000,
			spawnTerminal: () => ({
				on(
					event: "exit" | "error",
					fn: ((code: number | null, signal: NodeJS.Signals | null) => void) | ((error: Error) => void),
				) {
					if (event === "exit") exit = fn as (code: number | null, signal: NodeJS.Signals | null) => void;
					return this;
				},
				kill() {
					killed = true;
					return true;
				},
			}),
		});
		const operation = runner.start({
			id: "i",
			capability: "secret",
			provider: "fixture",
			finish: async (...args) => {
				finishes.push(args);
				return true;
			},
		});
		if (mode === "cancel") runner.cancel("i");
		else await vi.waitFor(() => expect(finishes).toHaveLength(1));
		if (mode === "cancel") {
			expect(finishes).toHaveLength(1);
			expect(finishes[0]?.[0]).toBe("cancelled");
		} else {
			expect(finishes[0]?.[0]).toBe("failed");
			expect(killed).toBe(true);
		}
		exit(0, null);
		await operation;
		expect(finishes).toHaveLength(1);
	}
});
