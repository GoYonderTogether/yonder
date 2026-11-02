import { chmod, mkdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { delimiter, dirname, join } from "node:path";
import { tempHome } from "@yonder/sdk/testing";
import { expect, test, vi } from "vitest";
import { AppServer } from "../src/app-server.js";

test("launches an isolated Node protocol fixture from a spaced PATH, including Windows npm shims", async () => {
	const root = await tempHome("codex-launch-");
	let client: AppServer | undefined;
	try {
		const bin = join(root, "bin & space");
		await mkdir(bin);
		const script = join(bin, "wire.cjs");
		await writeFile(
			script,
			`
const readline = require("node:readline");
// Stay alive after stdin ends: shutdown must terminate the owned process, not just its shell.
setInterval(() => {}, 1000);
readline.createInterface({input:process.stdin}).on("line", line => {
 const message = JSON.parse(line);
 if (message.id !== undefined) process.stdout.write(JSON.stringify({id:message.id,result:{args:process.argv.slice(2),params:message.params,pid:process.pid,cwd:process.cwd()}})+"\\n");
});
`,
		);
		if (process.platform === "win32") {
			await writeFile(join(bin, "codex.cmd"), `@echo off\r\n"${process.execPath}" "%~dp0wire.cjs" %*\r\n`);
		} else {
			const command = join(bin, "codex");
			await writeFile(command, `#!${process.execPath}\nrequire(${JSON.stringify(script)});\n`);
			await chmod(command, 0o700);
		}
		vi.stubEnv("PATH", [bin, dirname(process.execPath)].join(delimiter));
		const signal = AbortSignal.timeout(5000);
		client = await AppServer.open(signal);
		const params = { literal: 'spaces & echo BAD | < > %PATH% !value! "quoted"' };
		const reply = (await client.request("echo", params, signal)) as { pid: number; cwd: string };
		expect(reply).toEqual({ args: ["app-server"], params, pid: expect.any(Number), cwd: expect.any(String) });
		expect(await realpath(reply.cwd)).toBe(await realpath(client.cwd));
		await client.close();
		expect(() => process.kill(reply.pid, 0)).toThrow();
		await expect(stat(client.cwd)).rejects.toMatchObject({ code: "ENOENT" });
	} finally {
		await client?.close();
		vi.unstubAllEnvs();
		await rm(root, { recursive: true, force: true });
	}
});
