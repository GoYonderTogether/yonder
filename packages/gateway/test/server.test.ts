import { mkdtemp, readFile, rm } from "node:fs/promises";
import { request } from "node:http";
import { join } from "node:path";
import { initHome, openKernel, registry, releaseInfo } from "@yonder/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { type GatewayHandle, startGateway } from "../src/index.js";

// Real kernel in a temporary home; no model credentials are needed because nothing here waits for a model reply.
let home: string;
let kernel: Awaited<ReturnType<typeof openKernel>>;
let gateway: GatewayHandle;
let base: string;
let cookie: string;

type Frame = { t: string; sub?: string; [key: string]: unknown };

function connect(headers: Record<string, string>): Promise<WebSocket & { frames: Frame[] }> {
	return new Promise((resolve, reject) => {
		const ws = new WebSocket(`${base.replace("http", "ws")}/api/stream?v=1`, {
			headers: { origin: base, ...headers },
		}) as WebSocket & { frames: Frame[] };
		ws.frames = [];
		ws.on("message", (data) => ws.frames.push(JSON.parse(String(data)) as Frame));
		ws.on("open", () => resolve(ws));
		ws.on("unexpected-response", (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
		ws.on("error", reject);
	});
}

async function frame(ws: { frames: Frame[] }, match: (f: Frame) => boolean): Promise<Frame> {
	for (let i = 0; i < 200; i++) {
		const found = ws.frames.find(match);
		if (found) return found;
		await new Promise((r) => setTimeout(r, 25));
	}
	throw new Error("frame not received");
}

const rpc = async (method: string, params: unknown = {}, headers: Record<string, string> = { cookie }) =>
	(await (
		await fetch(`${base}/api/rpc/${method}`, {
			method: "POST",
			headers: { "content-type": "application/json", ...headers },
			body: JSON.stringify(params),
		})
	).json()) as { ok: boolean; result?: Record<string, unknown>; error?: { code: string } };

beforeAll(async () => {
	home = await mkdtemp("/tmp/yonder-gateway-");
	await initHome(home);
	kernel = await openKernel(home);
	gateway = await startGateway({
		home,
		host: { kernel, home, releaseInfo: () => releaseInfo(home), awakeStatus: () => ({}), stop: () => {} },
	});
	base = `http://127.0.0.1:${gateway.port}`;
}, 60_000);

afterAll(async () => {
	await gateway?.close();
	await kernel?.close();
	await rm(home, { recursive: true, force: true });
});

describe("gateway over a real kernel", () => {
	it("exchanges the startup ticket once and guards Host, Origin and cookie", async () => {
		const state = JSON.parse(await readFile(join(home, ".yonder", "gateway.json"), "utf8")) as { token: string };
		const first = await fetch(`${base}/?token=${state.token}`, { redirect: "manual" });
		expect(first.status).toBe(303);
		const setCookie = first.headers.get("set-cookie") ?? "";
		expect(setCookie).toMatch(/HttpOnly/);
		expect(setCookie).toMatch(/SameSite=Strict/);
		cookie = setCookie.split(";")[0] ?? "";
		const again = await fetch(`${base}/?token=${state.token}`, { redirect: "manual" });
		expect(again.headers.get("set-cookie")).toBeNull();

		const badHost = await new Promise<number>((resolve, reject) =>
			request(
				`${base}/api/rpc/capabilities.get`,
				{ method: "POST", headers: { host: "evil.example", cookie } },
				(res) => resolve(res.statusCode ?? 0),
			)
				.on("error", reject)
				.end(),
		);
		expect(badHost).toBe(403);
		const noCookie = await fetch(`${base}/api/rpc/capabilities.get`, {
			method: "POST",
			headers: { "content-type": "application/json", origin: base },
			body: "{}",
		});
		expect(noCookie.status).toBe(401);
		expect(noCookie.headers.get("content-security-policy")).toMatch(/script-src 'self'/);
		expect(noCookie.headers.get("x-content-type-options")).toBe("nosniff");
		expect(noCookie.headers.get("referrer-policy")).toBe("same-origin");
		const evil = await fetch(`${base}/api/rpc/capabilities.get`, {
			method: "POST",
			headers: { "content-type": "application/json", origin: "http://evil.example", cookie },
			body: "{}",
		});
		expect(evil.status).toBe(403);
	});

	it("answers like the registry and keeps local-only methods off the gateway", async () => {
		const caps = await rpc("capabilities.get", {}, { cookie, origin: base });
		expect(caps.result).toMatchObject({ protocol: 1, kind: "local" });
		const presets = await rpc("terminal.presets", {}, { cookie, origin: base });
		const direct = await registry.call(
			"terminal.presets",
			{},
			{
				kernel,
				home,
				releaseInfo: () => releaseInfo(home),
				awakeStatus: () => ({}),
				stop: () => {},
				principal: { id: "test", transport: "socket", kind: "local", scopes: ["read", "write", "admin"] },
			},
			new AbortController().signal,
			() => {},
		);
		expect(presets.result).toEqual(JSON.parse(JSON.stringify(direct)));
		expect((await rpc("stop", {}, { cookie, origin: base })).error?.code).toBe("forbidden");
	});

	it("resumes sessions.watch after a cursor and reports gap for unknown cursors", async () => {
		await expect(connect({})).rejects.toThrow("HTTP 401");
		const opened = await rpc("sessions.open", { preset: "default" }, { cookie, origin: base });
		const id = opened.result?.id as string;
		const ws = await connect({ cookie });
		ws.send(JSON.stringify({ t: "sub", sub: "a", method: "sessions.watch", params: { id } }));
		const ready = await frame(ws, (f) => f.t === "ready");
		expect(ready.gap).toBe(false);
		const one = await rpc("sessions.submit", { id, text: "one", requestId: "r1" }, { cookie, origin: base });
		const dup = await rpc("sessions.submit", { id, text: "one", requestId: "r1" }, { cookie, origin: base });
		expect(dup.result).toMatchObject({ event: one.result?.event, deduped: true });
		const ev = await frame(ws, (f) => f.t === "ev");
		expect(ev.seq).toBe(1);
		const cursor = ws.frames.filter((f) => f.t === "ev").at(-1)?.cursor as string;
		ws.close();

		await rpc("sessions.submit", { id, text: "two", requestId: "r2" }, { cookie, origin: base });
		const resumed = await connect({ cookie });
		resumed.send(JSON.stringify({ t: "sub", sub: "b", method: "sessions.watch", params: { id }, after: cursor }));
		expect((await frame(resumed, (f) => f.t === "ready")).gap).toBe(false);
		await frame(resumed, (f) => f.t === "ev");
		resumed.send(JSON.stringify({ t: "sub", sub: "c", method: "sessions.watch", params: { id }, after: "deadbeef:3" }));
		const gap = await frame(resumed, (f) => f.t === "ready" && f.sub === "c");
		expect(gap.gap).toBe(true);
		expect(gap.result).toBeTruthy();
		resumed.send(JSON.stringify({ t: "ping", n: 7 }));
		expect((await frame(resumed, (f) => f.t === "pong")).n).toBe(7);
		resumed.close();
		await rpc("sessions.abort", { id }, { cookie, origin: base });
	});
});
