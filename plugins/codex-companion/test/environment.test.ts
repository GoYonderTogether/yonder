import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import type { ToolContext } from "@yonder/sdk";
import { tempHome } from "@yonder/sdk/testing";
import { expect, test } from "vitest";
import { codexEnvironment, validateCodexHome } from "../src/index.js";

test("authorized home accepts absolute POSIX, drive and UNC paths, but not relative paths", () => {
	for (const home of ["/authorized/home", "C:\\Users\\owner\\codex", "\\\\server\\share\\codex"])
		expect(() => validateCodexHome(home)).not.toThrow();
	for (const home of ["", "relative/home", "C:relative", "~/codex"])
		expect(() => validateCodexHome(home)).toThrow("absolute authorized");
});

test("environment probes the actual host without launching Codex or copying login", async () => {
	const root = await tempHome("codex-environment-");
	try {
		const home = join(root, "authorized home");
		await mkdir(home);
		const ctx = { env: new NodeExecutionEnv({ cwd: root }), signal: new AbortController().signal } as ToolContext;
		const env = await codexEnvironment(ctx, home);
		expect(env).toMatchObject({ CODEX_HOME: home, HOME: home, USERPROFILE: home });
		expect(env.PATH).toBeTruthy();
		expect(Object.keys(env).sort()).toEqual(
			[
				"CODEX_HOME",
				"HOME",
				"PATH",
				"USERPROFILE",
				...(process.platform === "win32" && process.env.SystemRoot ? ["SystemRoot"] : []),
				...(process.platform === "win32" && process.env.PATHEXT ? ["PATHEXT"] : []),
			].sort(),
		);
		await expect(codexEnvironment(ctx, join(root, "missing"))).rejects.toThrow("codexHome must exist");
		await writeFile(join(root, "file"), "not a home");
		await expect(codexEnvironment(ctx, join(root, "file"))).rejects.toThrow("codexHome must exist");
		await expect(codexEnvironment(ctx, "relative")).rejects.toThrow("absolute authorized");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
