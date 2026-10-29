import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { initHome, openKernel, releaseInfo, setAccessTokenHash } from "@yonder/core";
import { afterAll, expect, it } from "vitest";
import { parse, stringify } from "yaml";
import { testModel } from "../../core/src/config/test-support.js";
import { tokenHash } from "../src/auth.js";
import { startGateway } from "../src/index.js";

const ACCESS = "remote-access-token-for-config-admin-test";
const cleanup: Array<() => Promise<void>> = [];
afterAll(async () => {
	for (const close of cleanup.reverse()) await close();
});

/** 真实网关 + 真实 home：remoteAdmin 关闭时远端不能改配置，打开后可以（G-08）。 */
async function start(remoteAdmin: boolean) {
	const home = await mkdtemp("/tmp/yonder-gateway-config-");
	cleanup.push(() => rm(home, { recursive: true, force: true }));
	await initHome(home, "owner", { model: testModel });
	await setAccessTokenHash(home, tokenHash(ACCESS));
	const config = parse(await readFile(join(home, "yonder.yaml"), "utf8"));
	config.gateway = { ...config.gateway, remoteAdmin };
	await writeFile(join(home, "yonder.yaml"), stringify(config));
	const kernel = await openKernel(home);
	cleanup.push(() => kernel.close());
	const gateway = await startGateway({
		home,
		host: { kernel, home, releaseInfo: () => releaseInfo(home), awakeStatus: () => ({}), stop: () => {} },
	});
	cleanup.push(() => gateway.close());
	const base = `http://127.0.0.1:${gateway.port}`;
	const login = await fetch(`${base}/login`, {
		method: "POST",
		headers: { "content-type": "application/json", origin: base },
		body: JSON.stringify({ token: ACCESS }),
	});
	const remote = (login.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
	const call = async (method: string, params: unknown) => {
		const res = await fetch(`${base}/api/rpc/${method}`, {
			method: "POST",
			headers: { "content-type": "application/json", origin: base, cookie: remote },
			body: JSON.stringify(params),
		});
		return { status: res.status, body: (await res.json()) as { ok: boolean; result?: Record<string, unknown> } };
	};
	return { call };
}

it("without gateway.remoteAdmin a remote login can read config but not update it", async () => {
	const { call } = await start(false);
	const view = await call("config.get", {});
	expect(view.status).toBe(200);
	expect(view.body.ok).toBe(true);
	// 读视图脱敏：不含任何凭据。
	expect(JSON.stringify(view.body.result)).not.toMatch(/apiKey|api_key|secret|credential/i);
	const update = await call("config.update", {
		expectedRevision: String(view.body.result?.revision),
		patch: { limits: { maxTokens: 4096 } },
	});
	expect(update.status).toBe(403);
	expect(update.body.ok).toBe(false);
});

it("with gateway.remoteAdmin the remote login gains admin and the update lands", async () => {
	const { call } = await start(true);
	const view = await call("config.get", {});
	expect(view.body.ok).toBe(true);
	const update = await call("config.update", {
		expectedRevision: String(view.body.result?.revision),
		patch: { limits: { maxTokens: 4096 } },
	});
	expect(update.status).toBe(200);
	expect(update.body.ok).toBe(true);
	expect((update.body.result as { limits?: { maxTokens?: number } }).limits?.maxTokens).toBe(4096);
	const after = await call("config.get", {});
	expect((after.body.result as { limits?: { maxTokens?: number } }).limits?.maxTokens).toBe(4096);
});
