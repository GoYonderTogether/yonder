import { execFile, execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { initHome, serveControl } from "@yonder/local-host";
import { testModel } from "@yonder/local-host/config/test-support";
import { tempHome } from "@yonder/sdk/testing";
import { expect, test } from "vitest";

const cli = resolve("packages/cli/dist/index.js");
const execFileAsync = promisify(execFile);

test("channels login card names the missing service instead of a bare ENOENT (JV2-J02-01)", async () => {
	const home = await tempHome("ya-");
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
	const home = await tempHome("ya-");
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
