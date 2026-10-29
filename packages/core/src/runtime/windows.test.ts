import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { BACKGROUND_CONTEXT, withAbortSignal } from "@earendil-works/chord/context";
import { expect, test } from "vitest";
import { requestControl } from "../control/index.js";
import { initHome } from "../kernel/home.js";
import { FileAuthStorageBackend } from "./credentials.js";
import { localEnvironment } from "./env.js";
import { shellCommand } from "./windows-process.js";

test.skipIf(process.platform !== "win32")(
	"Windows native PowerShell supports Unicode, spaced cwd and native exit codes",
	async () => {
		const home = await mkdtemp(join(tmpdir(), "yonder 空格-"));
		const env = localEnvironment(home);
		try {
			let text = "";
			const result = await env.exec(
				"[Console]::Write('中文'); exit 7",
				{
					onOutput: (chunk) => {
						text += chunk;
					},
				},
				BACKGROUND_CONTEXT,
			);
			expect(result).toEqual({ ok: true, value: { exitCode: 7 } });
			expect(text).toBe("中文");
		} finally {
			await env.cleanup(BACKGROUND_CONTEXT);
			await rm(home, { recursive: true, force: true });
		}
	},
);

test.skipIf(process.platform !== "win32")(
	"Windows cancellation settles the real local process",
	async () => {
		const home = await mkdtemp(join(tmpdir(), "yonder-cancel-"));
		const env = localEnvironment(home),
			abort = new AbortController();
		try {
			let started!: () => void;
			const ready = new Promise<void>((done) => {
				started = done;
			});
			const result = env.exec(
				"[Console]::WriteLine('ready'); Start-Sleep -Seconds 60",
				{ onOutput: () => started() },
				withAbortSignal(abort.signal, BACKGROUND_CONTEXT),
			);
			await ready;
			abort.abort();
			expect((await result).ok).toBe(false);
		} finally {
			await env.cleanup(BACKGROUND_CONTEXT);
			await rm(home, { recursive: true, force: true });
		}
	},
	15000,
);

test.skipIf(process.platform !== "win32")(
	"Windows credential storage writes and reopens a restricted real ACL",
	async () => {
		const home = await mkdtemp(join(tmpdir(), "yonder-acl-"));
		try {
			const file = join(home, "auth.json"),
				backend = new FileAuthStorageBackend(file, true);
			await backend.withLockAsync(async () => ({ result: undefined, next: "{}" }));
			expect(await backend.withLockAsync(async (current) => ({ result: current }))).toBe("{}");
		} finally {
			await rm(home, { recursive: true, force: true });
		}
	},
	20000,
);

test.skipIf(process.platform !== "win32")(
	"Windows built CLI starts, queries and stops through the same native pipe",
	async () => {
		const home = await mkdtemp(join(tmpdir(), "yonder-cli-"));
		await initHome(home, "owner", { isolated: true });
		const child = spawn(process.execPath, ["packages/cli/dist/index.js", "start", "--home", home, "--json"], {
			windowsHide: true,
			stdio: ["ignore", "pipe", "pipe"],
		});
		let output = "";
		child.stdout.on("data", (chunk) => {
			output += chunk;
		});
		child.stderr.on("data", (chunk) => {
			output += chunk;
		});
		try {
			await expect
				.poll(
					async () => {
						try {
							return await requestControl(home, { method: "service.info" });
						} catch {
							return undefined;
						}
					},
					{ timeout: 10000 },
				)
				.toMatchObject({ ready: true });
			expect(await requestControl(home, { method: "sessions.list", params: { filter: {} } })).toEqual([]);
			await requestControl(home, { method: "stop" });
			await expect.poll(() => child.exitCode, { timeout: 10000 }).toBe(0);
		} finally {
			if (child.exitCode === null) child.kill();
			await rm(home, { recursive: true, force: true });
		}
		expect(output).toContain("started");
	},
	25000,
);
