import { appendFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initHome, openKernel, releaseInfo, setAccessTokenHash } from "@yonder/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { testModel } from "../../core/src/config/test-support.js";
import { Sessions, tokenHash } from "../src/auth.js";
import { type GatewayHandle, startGateway } from "../src/index.js";

// Real kernel and real sockets; the gateway is configured with a base path, a trusted proxy and an access token.
const ACCESS = "long-lived-access-token";
let home: string;
let kernel: Awaited<ReturnType<typeof openKernel>>;
let gateway: GatewayHandle;
let base: string;

const open = (path: string, headers: Record<string, string>) =>
	new Promise<WebSocket>((resolve, reject) => {
		const ws = new WebSocket(`${base.replace("http", "ws")}${path}`, { headers: { origin: base, ...headers } });
		ws.on("open", () => resolve(ws));
		ws.on("unexpected-response", (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
		ws.on("error", reject);
	});
const connect = (headers: Record<string, string>) => open("/api/stream?v=1", headers);
const closeCode = (ws: WebSocket) => new Promise<number>((resolve) => ws.once("close", (code) => resolve(code)));
const login = (token: string, headers: Record<string, string> = {}) =>
	fetch(`${base}/login`, {
		method: "POST",
		headers: { "content-type": "application/json", origin: base, ...headers },
		body: JSON.stringify({ token }),
	});
const cookieOf = (res: Response) => (res.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
const localCookie = async () =>
	cookieOf(await fetch(`${base}/?token=${gateway.ticket().token}`, { redirect: "manual" }));
const settled = async (check: () => boolean) => {
	for (let i = 0; i < 120 && !check(); i++) await new Promise((r) => setTimeout(r, 25));
	return check();
};

beforeAll(async () => {
	home = await mkdtemp(join(tmpdir(), "ygh-"));
	await initHome(home, "owner", { model: testModel });
	await appendFile(`${home}/yonder.yaml`, "gateway:\n  basePath: /console/\n  trustProxy: true\n");
	await setAccessTokenHash(home, tokenHash(ACCESS));
	const staticDir = join(home, "static");
	await mkdir(join(staticDir, "assets"), { recursive: true });
	await writeFile(join(staticDir, "index.html"), "<head></head>");
	await writeFile(join(staticDir, "assets", "app-AbCd1234.js"), "export {};");
	await writeFile(join(staticDir, "version.json"), "{}");
	kernel = await openKernel(home);
	gateway = await startGateway({
		home,
		staticDir,
		host: { kernel, home, releaseInfo: () => releaseInfo(home), awakeStatus: () => ({}), stop: () => {} },
	});
	base = `http://127.0.0.1:${gateway.port}`;
}, 60_000);

afterAll(async () => {
	await gateway?.close();
	await kernel?.close();
	await rm(home, { recursive: true, force: true });
});

describe("gateway hardening", () => {
	it("closes with 1003 on valid JSON that is not a frame, and keeps serving", async () => {
		const cookie = await localCookie();
		for (const raw of ["null", "1", "[]", '"x"', "{}", '{"t":1}']) {
			const ws = await connect({ cookie });
			const code = closeCode(ws);
			ws.send(raw);
			expect(await code).toBe(1003);
		}
		const ws = await connect({ cookie });
		const pong = new Promise<string>((resolve) => ws.once("message", (data) => resolve(String(data))));
		ws.send(JSON.stringify({ t: "ping", n: 1 }));
		expect(JSON.parse(await pong)).toMatchObject({ t: "pong", n: 1 });
		ws.close();
	});

	it("accepts the access token only through POST /login, never in a URL", async () => {
		const viaUrl = await fetch(`${base}/?token=${ACCESS}`, { redirect: "manual" });
		expect(viaUrl.status).toBe(303);
		expect(viaUrl.headers.get("location")).toMatch(/login$/);
		expect(viaUrl.headers.get("set-cookie")).toBeNull();
		const posted = await login(ACCESS);
		expect(posted.status).toBe(200);
		expect(posted.headers.get("set-cookie")).toMatch(/yonder_session=.*Path=\/;/);
	});

	it("throttles per peer (trusted X-Forwarded-For) and never blocks a loopback ticket", async () => {
		const attacker = { "x-forwarded-for": "203.0.113.9, 10.0.0.1" };
		for (let i = 0; i < 10; i++) expect((await login("wrong", attacker)).status).toBe(401);
		expect((await login(ACCESS, attacker)).status).toBe(429);
		expect((await login(ACCESS, { "x-forwarded-for": "203.0.113.10" })).status).toBe(200);
		const recovery = await fetch(`${base}/?token=${gateway.ticket().token}`, {
			redirect: "manual",
			headers: attacker,
		});
		expect(recovery.status).toBe(303);
		expect(recovery.headers.get("set-cookie")).toMatch(/yonder_session=/);
	});

	it("serves loopback at / and at the base path, with a matching cookie Path", async () => {
		const plain = await fetch(`${base}/?token=${gateway.ticket().token}`, { redirect: "manual" });
		expect(plain.headers.get("set-cookie")).toMatch(/Path=\/;/);
		expect(plain.headers.get("location")).toBe("/");
		const prefixed = await fetch(`${base}/console/?token=${gateway.ticket().token}`, { redirect: "manual" });
		expect(prefixed.headers.get("set-cookie")).toMatch(/Path=\/console\/;/);
		expect(prefixed.headers.get("location")).toBe("/console/");
		const cookie = cookieOf(prefixed);
		const rpc = await fetch(`${base}/console/api/rpc/capabilities.get`, {
			method: "POST",
			headers: { "content-type": "application/json", origin: base, cookie },
			body: "{}",
		});
		expect(((await rpc.json()) as { ok: boolean }).ok).toBe(true);
		const ws = await open("/console/api/stream?v=1", { cookie });
		ws.close();
	});

	it("sets cache policy for console static files and SPA fallback", async () => {
		const cookie = cookieOf(await fetch(`${base}/console/?token=${gateway.ticket().token}`, { redirect: "manual" }));
		for (const [path, cache] of [
			["", "no-cache"],
			["settings", "no-cache"],
			["assets/app-AbCd1234.js", "public, max-age=31536000, immutable"],
			["version.json", "no-store"],
		]) {
			const response = await fetch(`${base}/console/${path}`, { headers: { cookie } });
			expect(response.status).toBe(200);
			expect(response.headers.get("cache-control")).toBe(cache);
		}
	});

	it("falls back to index.html for BrowserRouter deep links under the base path, injecting the mount", async () => {
		const cookie = cookieOf(await fetch(`${base}/console/?token=${gateway.ticket().token}`, { redirect: "manual" }));
		for (const path of ["work", "work/abc%20d", "work/console", "c/42", "friends/add"]) {
			const response = await fetch(`${base}/console/${path}`, { headers: { cookie } });
			expect(response.status).toBe(200);
			expect(response.headers.get("content-type")).toMatch(/text\/html/);
			expect(response.headers.get("cache-control")).toBe("no-cache");
			const html = await response.text();
			expect(html).toContain('<base href="/console/">');
			expect(html).toContain('<meta name="yonder-base-path" content="/console/">');
		}
		// 带扩展名的缺失资源仍是 404，不会被当成页面。
		const missing = await fetch(`${base}/console/assets/nope-AbCd1234.js`, { headers: { cookie } });
		expect(missing.status).toBe(404);
	});

	it("closes remote sockets when the access token is rotated", async () => {
		const cookie = cookieOf(await login(ACCESS, { "x-forwarded-for": "198.51.100.7" }));
		const remote = await connect({ cookie });
		const local = await connect({ cookie: await localCookie() });
		const code = closeCode(remote);
		await setAccessTokenHash(home, tokenHash("rotated-token"));
		expect(await code).toBe(4401);
		expect(local.readyState).toBe(WebSocket.OPEN);
		local.close();
		await expect(connect({ cookie })).rejects.toThrow("HTTP 401");
	}, 15_000);

	it("closes sockets when their cookie expires", async () => {
		const sessions = await Sessions.open(home);
		await expect(connect({ cookie: `yonder_session=${sessions.sign("local", undefined, -1)}` })).rejects.toThrow(
			"HTTP 401",
		);
		const ws = await connect({ cookie: `yonder_session=${sessions.sign("local", undefined, 800)}` });
		const code = closeCode(ws);
		expect(await code).toBe(4401);
	});

	it("refuses sockets beyond the global cap", async () => {
		const cookie = await localCookie();
		const held: WebSocket[] = [];
		for (let i = 0; i < 32; i++) held.push(await connect({ cookie }));
		await expect(connect({ cookie })).rejects.toThrow("HTTP 503");
		expect(gateway.stats().sockets).toBe(32);
		const closed = held.map((ws) => closeCode(ws));
		for (const ws of held) ws.close();
		await Promise.all(closed);
		expect(await settled(() => gateway.stats().sockets === 0)).toBe(true);
	}, 30_000);

	it("releases a feed whose subscriber leaves while the feed is still starting", async () => {
		const cookie = await localCookie();
		for (let i = 0; i < 20; i++) {
			const ws = await connect({ cookie });
			ws.send(JSON.stringify({ t: "sub", sub: "s", method: "activity.watch", params: {} }));
			ws.terminate();
		}
		await new Promise((r) => setTimeout(r, 300));
		expect(await settled(() => gateway.stats().sockets === 0 && gateway.stats().feeds === 0)).toBe(true);
	}, 30_000);

	it("releases a feed when unsub arrives in the same TCP write as sub", async () => {
		const ws = await connect({ cookie: await localCookie() });
		// Corked so both frames reach the server in one chunk: unsub lands while feeds.acquire() is pending.
		const raw = (ws as unknown as { _socket: { cork(): void; uncork(): void } })._socket;
		raw.cork();
		ws.send(JSON.stringify({ t: "sub", sub: "s", method: "activity.watch", params: {} }));
		ws.send(JSON.stringify({ t: "unsub", sub: "s" }));
		raw.uncork();
		// Give the (fast) startup time to finish, then nothing may be left behind.
		await new Promise((r) => setTimeout(r, 300));
		expect(await settled(() => gateway.stats().feeds === 0)).toBe(true);
		ws.close();
	});
});

it("serves views RPC and a fresh non-resumable views stream", async () => {
	const cookie = await localCookie();
	const response = await fetch(`${base}/api/rpc/views.list`, {
		method: "POST",
		headers: { cookie, origin: base, "content-type": "application/json" },
		body: "{}",
	});
	const body = (await response.json()) as { ok: boolean; result: { views: unknown[] } };
	expect(body.ok).toBe(true);
	expect(Array.isArray(body.result.views)).toBe(true);
	const ws = await connect({ cookie });
	const next = () =>
		new Promise<Record<string, unknown>>((resolve) => ws.once("message", (data) => resolve(JSON.parse(String(data)))));
	const ready = next();
	ws.send(JSON.stringify({ t: "sub", sub: "views", method: "views.watch", params: {} }));
	expect(await ready).toMatchObject({ t: "ready", sub: "views", gap: true, result: body.result });
	const end = next();
	ws.send(JSON.stringify({ t: "sub", sub: "after", method: "views.watch", params: {}, after: "cursor" }));
	expect(await end).toMatchObject({ t: "end", sub: "after", error: { code: "invalid_params" } });
	ws.close();
});
