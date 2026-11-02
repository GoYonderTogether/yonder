import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import { delimiter, dirname, join, relative } from "node:path";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import type { ToolContext } from "@yonder/sdk";
import { tempHome } from "@yonder/sdk/testing";
import { expect, test } from "vitest";
import { codexEnvironment, run, runCodex } from "../src/index.js";
import { npmCodexEntrySource } from "../src/resolve-command.js";

// Generated layout of npm cmd-shim 8.0.0 for a plain #!/usr/bin/env node entry.
const shim = (target: string) => `@ECHO off
GOTO start
:find_dp0
SET dp0=%~dp0
EXIT /b
:start
SETLOCAL
CALL :find_dp0

IF EXIST "%dp0%\\node.exe" (
  SET "_prog=%dp0%\\node.exe"
) ELSE (
  SET "_prog=node"
  SET PATHEXT=%PATHEXT:;.JS;=;%
)

endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\${target}" %*
`;

test("resolves only confirmed npm Node targets on the execution host and preserves literal argv", async () => {
	const root = await tempHome("companion-shim-");
	try {
		const ctx = { env: new NodeExecutionEnv({ cwd: root }), signal: new AbortController().signal } as ToolContext;
		const env = await codexEnvironment(ctx, root);
		const literal = 'space & echo BAD | < > %PATH% !value! "quote"';
		for (const local of [false, true]) {
			const prefix = join(root, local ? "local & space" : "global & space");
			const bin = local ? join(prefix, "node_modules", ".bin") : prefix;
			const pkg = join(prefix, "node_modules", "@openai", "codex");
			const entry = join(pkg, "bin", "codex.js");
			await mkdir(dirname(entry), { recursive: true });
			await mkdir(bin, { recursive: true });
			await writeFile(
				join(pkg, "package.json"),
				JSON.stringify({ name: "@openai/codex", bin: { codex: "bin/codex.js" } }),
			);
			await writeFile(
				entry,
				"#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify({args:process.argv.slice(2),home:process.env.HOME}));\n",
			);
			const command = join(bin, "codex.cmd");
			await writeFile(command, shim(relative(bin, entry).replaceAll("/", "\\")).replaceAll("\n", "\r\n"));
			const probe = await run(ctx, [
				"node",
				"-e",
				`${npmCodexEntrySource}\nprocess.stdout.write(npmCodexEntry(process.argv[1]));`,
				command,
			]);
			expect(probe.exitCode).toBe(0);
			expect(probe.stdout).toBe(entry);
			const isolated = { ...env, PATH: [bin, dirname(process.execPath)].join(delimiter) };
			// No real Codex exists in this PATH. POSIX also verifies the discovered Node argv directly.
			const result =
				process.platform === "win32"
					? await runCodex(ctx, [literal], isolated)
					: await run(ctx, [process.execPath, probe.stdout, literal], isolated);
			expect(JSON.parse(result.stdout)).toEqual({ args: [literal], home: root });
			await writeFile(join(pkg, "package.json"), JSON.stringify({ name: "not-codex", bin: { codex: "bin/codex.js" } }));
			const refused = await run(ctx, [
				"node",
				"-e",
				`${npmCodexEntrySource}\nnpmCodexEntry(process.argv[1]);`,
				command,
			]);
			expect(refused.exitCode).not.toBe(0);
			expect(refused.stderr).toContain("Unsupported Codex shim target");
			await writeFile(command, "@echo off\necho arbitrary custom wrapper\n");
			const unknown = await run(ctx, [
				"node",
				"-e",
				`${npmCodexEntrySource}\nnpmCodexEntry(process.argv[1]);`,
				command,
			]);
			expect(unknown.exitCode).not.toBe(0);
			expect(unknown.stderr).toContain("Unsupported Codex shim");
			if (process.platform === "win32") {
				await copyFile(process.execPath, join(bin, "codex.exe"));
				const native = await runCodex(ctx, ["-e", "process.stdout.write('native-node')"], {
					...isolated,
					PATHEXT: ".EXE;.CMD",
				});
				expect(native.stdout).toBe("native-node");
			}
		}
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
