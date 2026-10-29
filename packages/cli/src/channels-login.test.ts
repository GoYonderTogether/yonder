import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { initHome } from "@yonder/core";
import { expect, test } from "vitest";
import { testModel } from "../../core/src/config/test-support.js";

const cli = resolve("packages/cli/dist/index.js");

test("channels login card names the missing service instead of a bare ENOENT (JV2-J02-01)", async () => {
	const home = await mkdtemp(join(tmpdir(), "ya-"));
	try {
		await initHome(home, "owner", { model: testModel });
		let stderr = "";
		try {
			// No `yonder start` here on purpose: the control socket does not exist yet.
			execFileSync(process.execPath, [cli, "channels", "login", "card", "--home", home], { encoding: "utf8" });
			throw new Error("expected channels login to fail without a running service");
		} catch (error) {
			stderr = String((error as { stderr?: Buffer }).stderr ?? "");
		}
		expect(stderr).toContain("服务未启动，先运行 yonder start");
		expect(stderr).toContain("run `yonder start` first");
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});
