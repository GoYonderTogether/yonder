import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { initHome, openKernel, releaseInfo, setAccessTokenHash } from "@yonder/core";
import { afterAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { testModel } from "../../core/src/config/test-support.js";
import { tokenHash } from "../src/auth.js";
import { startGateway } from "../src/index.js";

// Real kernel and gateway: every session-scoped entry point refuses or filters Bot sessions without owner scope (§14.3).
const ACCESS = "remote-access-token-for-isolation-test";
const cleanup: Array<() => Promise<unknown>> = [];
afterAll(async () => {
	for (const fn of cleanup.reverse()) await fn();
});

type Body = { ok: boolean; result?: any; error?: { code: string } };
type Observer = (update: unknown) => Promise<void>;

async function start() {
	const home = await mkdtemp("/tmp/yonder-gateway-isolation-");
	await initHome(home, "owner", { model: testModel });
	await setAccessTokenHash(home, tokenHash(ACCESS));
	const kernel = await openKernel(home);
	const observers: Observer[] = [];
	// Only terminal.observe is replaced, so a test can inject updates into the real gateway stream.
	const terminal = new Proxy(kernel.terminal, {
		get(target, key, receiver) {
			if (key !== "observe") return Reflect.get(target, key, receiver);
			return async (_id: string, listener: Observer) => {
				observers.push(listener);
				return async () => {
					observers.splice(observers.indexOf(listener), 1);
				};
			};
		},
	});
	const hostKernel = new Proxy(kernel, { get: (t, k, r) => (k === "terminal" ? terminal : Reflect.get(t, k, r)) });
	const gateway = await startGateway({
		home,
		host: { kernel: hostKernel, home, releaseInfo: () => releaseInfo(home), awakeStatus: () => ({}), stop: () => {} },
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
		return { status: res.status, body: (await res.json()) as Body };
	};
	return { base, local, remote, call, kernel, observers };
}

describe("remote isolation of Bot sessions", () => {
	it("denies or filters every session entry point without owner and works with owner", async () => {
		const { local, remote, call, kernel } = await start();
		const bot = (await call(local, "bots.send", { agent: "main", text: "hi" })).body.result.session as string;
		const task = (await call(local, "sessions.open", { preset: "default" })).body.result.id as string;
		expect((await kernel.sessions.get(bot))?.mode).not.toBe("task");

		for (const [method, params] of [
			["sessions.notify", { id: bot, event: "e", text: "t" }],
			["sessions.command", { id: bot, command: "/help" }],
			["sessions.submit", { id: bot, text: "x" }],
			["terminal.info", { id: bot }],
			["terminal.queued", { id: bot }],
			["terminal.dequeue", { id: bot }],
		] as const) {
			const denied = await call(remote, method, params);
			expect(denied.status, method).toBe(403);
			expect(denied.body.error?.code, method).toBe("forbidden");
			const allowed = await call(local, method, params);
			expect(allowed.body.error?.code, `${method} owner`).not.toBe("forbidden");
		}
		// Task sessions stay reachable without owner.
		expect((await call(remote, "terminal.info", { id: task })).status).toBe(200);
		expect((await call(remote, "terminal.queued", { id: task })).status).toBe(200);

		const ids = (rows: { id: string }[]) => rows.map((row) => row.id);
		expect(ids((await call(remote, "terminal.sessions")).body.result)).toEqual(expect.arrayContaining([task]));
		expect(ids((await call(remote, "terminal.sessions")).body.result)).not.toContain(bot);
		expect(ids((await call(local, "terminal.sessions")).body.result)).toContain(bot);

		// events.query: submit routes events into both sessions; non-owner only sees task-routed ones.
		await call(local, "sessions.submit", { id: task, text: "task text" });
		const routed = (rows: { routes?: { session?: string }[] }[]) =>
			rows.flatMap((row) => (row.routes ?? []).map((route) => route.session));
		const remoteEvents = (await call(remote, "events.query", { query: {} })).body.result.events;
		const localEvents = (await call(local, "events.query", { query: {} })).body.result.events;
		expect(routed(remoteEvents)).not.toContain(bot);
		expect(routed(localEvents)).toContain(bot);
		expect(localEvents.length).toBeGreaterThan(remoteEvents.length);
	}, 60_000);

	it("activity.summary only counts task sessions without owner", async () => {
		const { local, remote, call, kernel } = await start();
		const bot = (await call(local, "bots.send", { agent: "main", text: "hi" })).body.result.session as string;
		const task = (await call(local, "sessions.open", { preset: "default" })).body.result.id as string;
		await call(local, "sessions.submit", { id: task, text: "work" });
		await call(local, "sessions.submit", { id: bot, text: "work" }).catch(() => {});
		const ids = (body: Body) => (body.result.sessions as { id: string }[]).map((row) => row.id);
		const remoteIds = ids((await call(remote, "activity.summary")).body);
		const localIds = ids((await call(local, "activity.summary")).body);
		expect(remoteIds).not.toContain(bot);
		for (const id of remoteIds) expect((await kernel.sessions.get(id))?.mode).toBe("task");
		expect(localIds.length).toBeGreaterThanOrEqual(remoteIds.length);
	}, 60_000);
});

describe("stream continuity", () => {
	it("keeps delivering valid events after an invalid one", async () => {
		const { base, local, call, observers } = await start();
		const task = (await call(local, "sessions.open", { preset: "default" })).body.result.id as string;
		const ws = new WebSocket(`${base.replace("http", "ws")}/api/stream?v=1`, {
			headers: { origin: base, cookie: local },
		});
		const frames: { t: string; type?: string; data?: unknown }[] = [];
		ws.on("message", (raw) => frames.push(JSON.parse(raw.toString())));
		await new Promise((resolve, reject) => {
			ws.on("open", resolve);
			ws.on("error", reject);
		});
		ws.send(JSON.stringify({ t: "sub", sub: "w", method: "sessions.watch", params: { id: task } }));
		await expect.poll(() => frames.some((f) => f.t === "ready")).toBe(true);
		const emit = async (update: unknown) => {
			for (const observer of [...observers]) await observer(update);
		};
		const usage = { session: task, tokens: 1, window: 10, percent: 10, auto: true };
		await emit({ type: "event", name: "context.updated", data: usage });
		await emit({ type: "event", name: "context.updated", data: { text: "invalid" } });
		await emit({ type: "event", name: "unknown.carrier", data: {} });
		await emit({ type: "event", name: "context.updated", data: { ...usage, tokens: 2 } });
		await expect.poll(() => frames.filter((f) => f.type === "context.updated").length).toBe(2);
		expect(
			frames.filter((f) => f.type === "context.updated").map((f) => (f.data as { tokens: number }).tokens),
		).toEqual([1, 2]);
		ws.close();
	}, 60_000);
});
