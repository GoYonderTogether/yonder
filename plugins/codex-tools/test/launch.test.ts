import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
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
readline.createInterface({input:process.stdin}).on("line", line => {
 const message = JSON.parse(line);
 if (message.id !== undefined) process.stdout.write(JSON.stringify({id:message.id,result:{args:process.argv.slice(2),params:message.params}})+"\\n");
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
		expect(await client.request("echo", params, signal)).toEqual({ args: ["app-server"], params });
	} finally {
		await client?.close();
		vi.unstubAllEnvs();
		await rm(root, { recursive: true, force: true });
	}
});
