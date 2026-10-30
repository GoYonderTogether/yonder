import { execFile, execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { initHome, serveControl } from "@yonder/core";
import { expect, test } from "vitest";
import { testModel } from "../../core/src/config/test-support.js";

const cli = resolve("packages/cli/dist/index.js");
const execFileAsync = promisify(execFile);

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

test("channels login --replace forwards explicit replacement to the service", async () => {
	const home = await mkdtemp(join(tmpdir(), "ya-"));
	const requests: unknown[] = [];
	const server = await serveControl(home, async (request) => {
		requests.push(request);
		return { status: "pending" };
	});
	try {
		await execFileAsync(process.execPath, [cli, "channels", "login", "wx", "--replace", "--home", home]);
		expect(requests).toEqual([
			{ method: "channels.login", params: { instance: "wx", action: "start", replace: true } },
		]);
	} finally {
		await server.close();
		await rm(home, { recursive: true, force: true });
	}
});
