import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createLoginHostAdapter } from "./login-host-adapter.js";

describe("login host adapter", () => {
	it("waits for the wrapper result after launcher exit and finishes once", async () => {
		const dir = await mkdtemp(join(tmpdir(), "login-adapter-"));
		const gate = join(dir, "gate");
		const cli = join(dir, "fake-cli.mjs");
		await writeFile(
			cli,
			`import { access } from 'node:fs/promises'; import { setTimeout as delay } from 'node:timers/promises'; while (true) { try { await access(${JSON.stringify(gate)}); break; } catch { await delay(10); } } process.exit(0);`,
		);
		let complete!: () => void;
		const done = new Promise<void>((resolve) => {
			complete = resolve;
		});
		let calls = 0;
		const adapter = createLoginHostAdapter({
			home: dir,
			nodeExecutable: process.execPath,
			cliEntry: cli,
			json: false,
			output: () => {},
			launch: async (path) => {
				const child = spawn("bash", [path], { stdio: "ignore", detached: true });
				child.unref();
				await new Promise<void>((resolve, reject) => {
					child.once("error", reject);
					child.once("spawn", resolve);
				});
			},
		});
		await adapter.start({
			id: "op",
			capability: "login",
			provider: "openai",
			finish: async (outcome, code) => {
				calls++;
				expect(outcome).toBe("succeeded");
				expect(code).toBe(0);
				complete();
				return true;
			},
		});
		await new Promise((resolve) => setTimeout(resolve, 100));
		expect(calls).toBe(0);
		await writeFile(gate, "release");
		await Promise.race([
			done,
			new Promise((_, reject) => setTimeout(() => reject(new Error("completion timeout")), 3000)),
		]);
		expect(calls).toBe(1);
	});
});
