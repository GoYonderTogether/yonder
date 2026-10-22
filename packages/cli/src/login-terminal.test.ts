import { mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { launchTerminalLogin, readLoginResult } from "./login-terminal.js";

describe("terminal login monitor", () => {
	it("does not mistake launch exit for completion; finishes once when result appears", async () => {
		const dir = await mkdtemp(join(tmpdir(), "login-monitor-"));
		const resultPath = join(dir, "result.json");
		let calls = 0;
		await launchTerminalLogin({
			wrapperPath: "/fake-wrapper",
			resultPath,
			timeoutMs: 2000,
			launch: async () => {
				await new Promise((resolve) => setTimeout(resolve, 30));
				await writeFile(resultPath, '{"status":"complete","code":0}\n', { mode: 0o600 });
			},
			finish: (result) => {
				calls++;
				expect(result).toEqual({ status: "complete", code: 0 });
			},
		});
		expect(calls).toBe(1);
	});
	it("rejects symlinks and malformed schemas; reports timeout", async () => {
		const dir = await mkdtemp(join(tmpdir(), "login-monitor-"));
		const target = join(dir, "target");
		const path = join(dir, "result.json");
		await writeFile(target, '{"status":"complete","code":0}');
		await symlink(target, path);
		expect(await readLoginResult(path)).toBeUndefined();
		await writeFile(path, '{"status":"complete","code":0,"stderr":"secret"}');
		expect(await readLoginResult(path)).toBeUndefined();
		let result: unknown;
		await launchTerminalLogin({
			wrapperPath: "x",
			resultPath: join(dir, "missing"),
			timeoutMs: 10,
			launch: async () => {},
			finish: (value) => {
				result = value;
			},
		});
		expect(result).toEqual({ status: "timeout" });
	});
});
