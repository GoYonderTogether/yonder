import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { initHome, openKernel, releaseInfo, setAccessTokenHash } from "@yonder/core";
import { afterAll, describe, expect, it } from "vitest";
import { parse, stringify } from "yaml";
import { tokenHash } from "../src/auth.js";
import { startGateway } from "../src/index.js";

// Real kernel and gateway; bots.send's happy path (routing into the main session) is covered in core's console.test.ts.
const ACCESS = "remote-access-token-for-bots-test";
const cleanup: Array<() => Promise<unknown>> = [];
afterAll(async () => {
	for (const fn of cleanup.reverse()) await fn();
});

async function start(remoteOwner: boolean) {
	const home = await mkdtemp("/tmp/yonder-gateway-bots-");
	await initHome(home);
	await setAccessTokenHash(home, tokenHash(ACCESS));
	if (remoteOwner) {
		const config = parse(await readFile(join(home, "yonder.yaml"), "utf8"));
		config.gateway = { ...config.gateway, remoteOwner: true };
		await writeFile(join(home, "yonder.yaml"), stringify(config));
	}
	const kernel = await openKernel(home);
	const gateway = await startGateway({
		home,
		host: { kernel, home, releaseInfo: () => releaseInfo(home), awakeStatus: () => ({}), stop: () => {} },
	});
	cleanup.push(async () => {
		await gateway.close();
		await kernel.close();
		await rm(home, { recursive: true, force: true });
	});
	const base = `http://127.0.0.1:${gateway.port}`;
	const state = JSON.parse(await readFile(join(home, ".yonder", "gateway.json"), "utf8")) as { token: string };
	const ticket = await fetch(`${base}/?token=${state.token}`, { redirect: "manual" });
	const local = (ticket.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
	const login = await fetch(`${base}/login`, {
		method: "POST",
		headers: { "content-type": "application/json", origin: base },
		body: JSON.stringify({ token: ACCESS }),
	});
	const remote = (login.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
	const call = async (cookie: string, method: string, params: unknown = {}) => {
		const res = await fetch(`${base}/api/rpc/${method}`, {
			method: "POST",
			headers: { "content-type": "application/json", origin: base, cookie },
			body: JSON.stringify(params),
		});
		return { status: res.status, body: (await res.json()) as { ok: boolean; result?: any; error?: { code: string } } };
	};
	return { local, remote, call };
}

describe("bots.* scope", () => {
	it("local login has owner scope; a remote token without remoteOwner gets 403", async () => {
		const { local, remote, call } = await start(false);
		const listed = await call(local, "bots.list");
		expect(listed.status).toBe(200);
		expect(listed.body.result.bots).toEqual([expect.objectContaining({ agent: "main", name: "Jarvis" })]);
		expect((await call(local, "bots.send", { agent: "nobody", text: "hi" })).body.error).toBeDefined();
		expect((await call(remote, "sessions.list")).status).toBe(200);
		for (const [method, params] of [
			["bots.list", {}],
			["bots.send", { agent: "main", text: "hi" }],
		] as const) {
			const denied = await call(remote, method, params);
			expect(denied.status).toBe(403);
			expect(denied.body.error?.code).toBe("forbidden");
		}
		const caps = await call(remote, "capabilities.get");
		expect(caps.body.error).toBeUndefined();
		expect(Object.keys(caps.body.result.methods)).not.toContain("bots.send");
	}, 60_000);

	it("gateway.remoteOwner grants the remote token owner scope", async () => {
		const { remote, call } = await start(true);
		const listed = await call(remote, "bots.list");
		expect(listed.status).toBe(200);
		expect(listed.body.result.bots[0].agent).toBe("main");
	}, 60_000);
});
