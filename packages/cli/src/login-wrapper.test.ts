import { execFile } from "node:child_process";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { createLoginWrapper } from "./login-wrapper.js";

const exec = promisify(execFile);

describe("controlled login wrapper", () => {
	it("rejects providers outside the allowlist", async () => {
		await expect(
			createLoginWrapper({ nodeExecutable: "/node", cliEntry: "/cli", home: "/home", provider: "evil" }),
		).rejects.toThrow("Unsupported");
	});
	it("writes restricted executable files", async () => {
		const wrapper = await createLoginWrapper({
			nodeExecutable: "/node",
			cliEntry: "/cli",
			home: "/home",
			provider: "openai",
		});
		expect((await stat(wrapper.wrapperPath)).mode & 0o777).toBe(0o700);
		expect(wrapper.wrapperPath).toContain("yonder-login-");
	});
	it.each([0, 7])("shell-quotes paths and reports only CLI exit code %i", async (exitCode) => {
		const dir = await mkdtemp(join(tmpdir(), "login-test-"));
		const nodePath = join(dir, "fake node 'quoted'");
		const cliPath = join(dir, "fake cli 'quoted'");
		const home = join(dir, "home ' ; touch injected");
		await writeFile(nodePath, `#!/bin/bash\nexit ${exitCode}\n`, { mode: 0o700 });
		const wrapper = await createLoginWrapper({ nodeExecutable: nodePath, cliEntry: cliPath, home, provider: "openai" });
		const result = await exec("/bin/bash", [wrapper.wrapperPath]).catch((error: { code: number }) => error);
		expect("code" in result ? result.code : 0).toBe(exitCode);
		expect(JSON.parse(await readFile(wrapper.resultPath, "utf8"))).toEqual({ status: "complete", code: exitCode });
		expect((await stat(wrapper.resultPath)).mode & 0o777).toBe(0o600);
		expect(await import("node:fs").then(({ existsSync }) => existsSync(join(dir, "injected")))).toBe(false);
	});
});
