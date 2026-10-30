import { privatePath } from "@yonder/sdk";
// Contract tests: a loopback backend protocol double, never a model double.

import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { hostname, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { EventInput, PluginAPI, ToolContext, YEvent } from "@yonder/sdk";
import { checkPlugin, createRegistrationCollector } from "@yonder/sdk/testing";
import { afterEach, expect, test, vi } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import { CardChannel, type Config } from "../src/channel.js";
import plugin from "../src/index.js";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
	vi.useRealTimers();
	for (const close of cleanups.splice(0).reverse()) await close();
});
const signal = () => new AbortController().signal;
async function fixture(config: Omit<Config, "endpoint"> = {}) {
	const data = await mkdtemp(join(tmpdir(), "yonder-card-contract-"));
	cleanups.push(() => rm(data, { recursive: true, force: true }));
	const calls: { path: string; body: unknown; auth: string | undefined }[] = [];
	let poll = "pending";
	let mode = "sent";
	let rateLimited = false;
	const invites = new Map<string, { owner: string; expiresAt: string; used: boolean }>();
	const frames: Record<string, unknown>[] = [];
	const server = createServer(async (req, res) => {
		let text = "";
		for await (const chunk of req) text += chunk;
		const body = text ? JSON.parse(text) : undefined;
		calls.push({ path: req.url!, body, auth: req.headers.authorization });
		res.setHeader("content-type", "application/json");
		// B contract: human web session issues an account-bound, ten-minute, single-use numeric code.
		if (req.method === "POST" && req.url === "/api/device/invite") {
			if (req.headers.cookie !== "session=contract-human") {
				res.statusCode = 401;
				res.end(JSON.stringify({ error: "unauthorized" }));
				return;
			}
			const code = String(1000000000 + invites.size);
			const expiresAt = new Date(Date.now() + 600000).toISOString();
			invites.set(code, { owner: "contract-human", expiresAt, used: false });
			res.end(JSON.stringify({ code, expiresAt }));
		} else if (req.method === "POST" && req.url === "/api/device/redeem") {
			if (rateLimited) {
				res.statusCode = 429;
				res.end(JSON.stringify({ error: "rate_limited" }));
				return;
			}
			const invite = invites.get(body.code);
			if (!invite || invite.used || Date.parse(invite.expiresAt) <= Date.now()) {
				res.statusCode = 404;
				res.end(JSON.stringify({ error: "invalid_code" }));
				return;
			}
			expect(invite.owner).toBe("contract-human");
			expect(body).toEqual({ code: body.code, name: hostname(), kind: config.device?.kind ?? "desktop" });
			expect(req.headers.authorization).toBeUndefined();
			invite.used = true;
			res.end(JSON.stringify({ deviceToken: "contract-token" }));
		} else if (req.url === "/api/device/start")
			res.end(JSON.stringify({ code: "contract-code", url: `${endpoint}/connect?code=contract-code` }));
		else if (req.url?.startsWith("/api/device/poll")) {
			if (poll === "invalid_code") {
				res.statusCode = 404;
				res.end(JSON.stringify({ error: "invalid_code" }));
			} else
				res.end(JSON.stringify({ status: poll, ...(poll === "confirmed" ? { deviceToken: "contract-token" } : {}) }));
		} else if (req.url === "/api/device/agents")
			res.end(JSON.stringify(body.map((a: { key: string }) => ({ key: a.key, id: `platform-${a.key}` }))));
		else if (req.url === "/api/device/dm") res.end(JSON.stringify({ convId: "dm-room" }));
		else if (req.url === "/api/device/cards")
			res.end(JSON.stringify({ id: "card", ownerId: body.agentId, status: "draft" }));
		else {
			res.statusCode = 404;
			res.end("{}");
		}
	});
	await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
	const endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
	const wss = new WebSocketServer({ server, path: "/ws/device" });
	wss.on("connection", (ws, req) => {
		expect(req.headers.authorization).toBe("Bearer contract-token");
		ws.on("message", (raw) => {
			const frame = JSON.parse(raw.toString());
			frames.push(frame);
			if (frame.type === "send") {
				if (mode === "sent") ws.send(JSON.stringify({ type: "sent", ref: frame.ref, message: { id: "accepted" } }));
				else if (mode === "error") ws.send(JSON.stringify({ type: "error", ref: frame.ref, error: "forbidden" }));
				else if (mode === "legacy-error") ws.send(JSON.stringify({ error: "forbidden" }));
				else if (mode === "wrong-ref")
					ws.send(JSON.stringify({ type: "sent", ref: "wrong", message: { id: "wrong" } }));
				else if (mode === "disconnect") ws.terminate();
			}
		});
	});
	cleanups.push(async () => {
		for (const ws of wss.clients) ws.terminate();
		await new Promise<void>((r) => wss.close(() => r()));
		await new Promise<void>((r) => server.close(() => r()));
	});
	const events: EventInput[] = [];
	let accept: (() => Promise<void>) | undefined;
	const list = vi.fn(async () => [
		{ id: "main", name: "Main" },
		{ id: "other", name: "Other" },
	]);
	const api = { paths: { data }, agents: { list }, log: { warn: vi.fn() } } as unknown as PluginAPI;
	const channel = new CardChannel("card-local", { ...config, endpoint }, api);
	cleanups.push(() => channel.stop());
	await channel.start({
		emit: async (event) => {
			if (accept) await accept();
			events.push(event);
			return { ...event, id: "event", ts: new Date().toISOString() } as YEvent;
		},
		ask: async () => {
			throw new Error("no ask");
		},
	});
	async function login() {
		const result = await channel.login("start", signal());
		expect(result).toMatchObject({ status: "pending", qrcodeUrl: `${endpoint}/connect?code=contract-code` });
		poll = "confirmed";
		await channel.login("poll", signal());
		await vi.waitFor(() => expect(frames.some((f) => f.type === "hello")).toBe(true));
	}
	const sendInput = (agent = "main", seq = 1, kind = "dm", mentioned = true) => {
		const ws = [...wss.clients].find((ws) => ws.readyState === WebSocket.OPEN)!;
		ws.send(
			JSON.stringify({
				type: "message",
				agentId: `platform-${agent}`,
				convId: "room",
				convKind: kind,
				mentioned,
				message: {
					id: `message-${seq}`,
					senderId: "human",
					seq,
					createdAt: 1720000000000,
					replyTo: "previous",
					content: { type: "text", text: "hello" },
				},
			}),
		);
	};
	return {
		data,
		calls,
		frames,
		events,
		api,
		channel,
		endpoint,
		list,
		login,
		sendInput,
		async invite() {
			const response = await fetch(`${endpoint}/api/device/invite`, {
				method: "POST",
				headers: { cookie: "session=contract-human" },
			});
			expect(response.status).toBe(200);
			const result = await response.json();
			expect(result).toEqual({ code: expect.stringMatching(/^\d{10}$/), expiresAt: expect.any(String) });
			expect(Date.parse(result.expiresAt) - Date.now()).toBeGreaterThan(590000);
			expect(Date.parse(result.expiresAt) - Date.now()).toBeLessThanOrEqual(600000);
			return result.code as string;
		},
		invites,
		setRateLimited: () => {
			rateLimited = true;
		},
		setPoll: (v: string) => {
			poll = v;
		},
		setMode: (v: string) => {
			mode = v;
		},
		setAccept: (fn: () => Promise<void>) => {
			accept = fn;
		},
	};
}

test("manifest and setup only register; provider declares multiAgent", async () => {
	expect(await checkPlugin(resolve("plugins/channel-card"))).toEqual([]);
	const { api, registrations } = createRegistrationCollector();
	await plugin.setup(api as PluginAPI);
	expect(registrations.channels[0]).toMatchObject({ type: "card", multiAgent: true });
	expect(registrations.tools.map((t) => t.name)).toEqual(["channel-card_card_push"]);
});

test("device flow, private token, agent identity, direct metadata and ack after acceptance", async () => {
	const f = await fixture();
	await f.login();
	expect(f.calls.find((c) => c.path === "/api/device/start")?.body).toMatchObject({ kind: "desktop" });
	expect(f.calls.find((c) => c.path === "/api/device/agents")?.body).toEqual([
		{ key: "main", name: "Main" },
		{ key: "other", name: "Other" },
	]);
	privatePath(f.data);
	privatePath(join(f.data, "card-local.json"));
	expect(await readFile(join(f.data, "card-local.json"), "utf8")).toContain("contract-token");
	let release!: () => void;
	f.setAccept(
		() =>
			new Promise<void>((r) => {
				release = r;
			}),
	);
	f.sendInput("other", 7, "group", false);
	await vi.waitFor(() => expect(release).toBeTypeOf("function"));
	expect(f.frames.filter((x) => x.type === "ack")).toHaveLength(0);
	release();
	await vi.waitFor(() => expect(f.frames.filter((x) => x.type === "ack")).toHaveLength(1));
	expect(f.events[0]).toEqual({
		type: "message.in",
		from: "acct:card-local:other:human",
		conv: "conv:card-local:other:room",
		data: {
			kind: "group",
			target: "other",
			text: "hello",
			mentioned: false,
			msgId: "message-7",
			replyTo: "previous",
			createdAt: "1720000000000",
		},
	});
	expect(await f.channel.send("conv:card-local:other:room", { text: "reply" })).toEqual({ ok: true, id: "accepted" });
	expect(f.frames.find((x) => x.type === "send")).toMatchObject({ agentId: "platform-other", convId: "room" });
	expect(await f.channel.send("acct:card-local:main:human", { text: "DM" })).toMatchObject({ ok: true });
	expect(f.calls.find((c) => c.path === "/api/device/dm")?.body).toEqual({
		agentId: "platform-main",
		accountId: "human",
	});
});

test("timeout, wrong receipt and uncorrelated backend error never report accepted or resend", async () => {
	const f = await fixture();
	await f.login();
	for (const mode of ["wrong-ref", "legacy-error"]) {
		f.setMode(mode);
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
		const before = f.frames.filter((f) => f.type === "send").length;
		const sending = f.channel.send("conv:card-local:main:room", { text: "once" });
		await vi.advanceTimersByTimeAsync(15000);
		expect(await sending).toMatchObject({ ok: false, uncertain: true });
		vi.useRealTimers();
		await vi.waitFor(() => expect(f.frames.filter((f) => f.type === "send")).toHaveLength(before + 1));
	}
});

test("correlated rejection, disconnect, cancellation and invalid target", async () => {
	const f = await fixture();
	await f.login();
	f.setMode("error");
	expect(await f.channel.send("conv:card-local:main:room", { text: "no" })).toEqual({
		ok: false,
		error: "Card send rejected",
	});
	f.setMode("silent");
	const controller = new AbortController();
	const pending = f.channel.send("conv:card-local:main:room", { text: "abort" }, controller.signal);
	controller.abort();
	expect(await pending).toMatchObject({ ok: false, uncertain: true });
	f.setMode("disconnect");
	expect(await f.channel.send("conv:card-local:main:room", { text: "disconnect" })).toMatchObject({
		ok: false,
		uncertain: true,
	});
	expect(await f.channel.send("conv:else:main:room", { text: "" })).toMatchObject({ ok: false });
	expect(await f.channel.send("conv:card-local:missing:room", { text: "" })).toMatchObject({ ok: false });
});

test("used and real invalid_code terminate polling; background confirmation and ten minute sync", async () => {
	const f = await fixture();
	await f.channel.login("start", signal());
	f.setPoll("used");
	expect(await f.channel.login("poll", signal())).toMatchObject({ status: "used" });
	await f.channel.login("start", signal());
	f.setPoll("invalid_code");
	expect(await f.channel.login("poll", signal())).toMatchObject({ status: "invalid_code" });
	await f.channel.login("start", signal());
	f.setPoll("confirmed");
	await vi.waitFor(() => expect(f.calls.some((c) => c.path === "/api/device/agents")).toBe(true), { timeout: 4000 });
	vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
	// Restart with the persisted credential to install a controlled sync timer.
	await f.channel.stop();
	await f.channel.start({
		emit: async () => {
			throw new Error("unused");
		},
		ask: async () => {
			throw new Error("unused");
		},
	});
	const count = f.list.mock.calls.length;
	await vi.advanceTimersByTimeAsync(600000);
	await vi.waitFor(() => expect(f.list.mock.calls.length).toBe(count + 1));
});

test("failed emit never ack; card tool takes identity only from ToolContext", async () => {
	const f = await fixture();
	await f.login();
	f.setAccept(async () => {
		throw new Error("not persisted");
	});
	f.sendInput();
	await vi.waitFor(() => expect(f.api.log.warn).toHaveBeenCalled());
	expect(f.frames.filter((x) => x.type === "ack")).toHaveLength(0);
	const { api, registrations } = createRegistrationCollector();
	await plugin.setup({ ...f.api, ...api } as PluginAPI);
	const channel = (await registrations.channels[0]!.create("tool", { endpoint: f.endpoint })) as CardChannel;
	cleanups.push(() => channel.stop());
	await channel.start({
		emit: async () => {
			throw new Error("unused");
		},
		ask: async () => {
			throw new Error("unused");
		},
	});
	await channel.login("start", signal());
	await channel.login("poll", signal());
	const tool = registrations.tools[0]!;
	const ctx = { agent: "other", signal: signal() } as ToolContext;
	expect(await tool.execute({ instance: "tool", title: "Title", markdown: "Body" }, ctx)).not.toHaveProperty("isError");
	expect(f.calls.find((c) => c.path === "/api/device/cards")?.body).toEqual({
		agentId: "platform-other",
		title: "Title",
		markdown: "Body",
	});
	expect(await tool.execute({ instance: "tool", title: "", markdown: "", agentId: "main" }, ctx)).toMatchObject({
		isError: true,
	});
});

// Contract tests for B: the backend is implemented separately; these are not integration evidence.
test.each([
	["start", undefined],
	["poll", "laptop"],
	["start", "server"],
] as const)("invite contract: %s redeems with kind %s, private token and all agents", async (action, kind) => {
	const f = await fixture(kind ? { device: { kind } } : {});
	const code = await f.invite();
	const result = await f.channel.login(action, signal(), code);
	expect(result).toEqual({ status: "connected", instance: "card-local" });
	expect(f.calls.find((c) => c.path === "/api/device/redeem")).toEqual({
		path: "/api/device/redeem",
		body: { code, name: hostname(), kind: kind ?? "desktop" },
		auth: undefined,
	});
	expect(f.calls.some((c) => /\/(start|poll|confirm)/.test(c.path))).toBe(false);
	expect(f.calls.find((c) => c.path === "/api/device/agents")).toEqual({
		path: "/api/device/agents",
		body: [
			{ key: "main", name: "Main" },
			{ key: "other", name: "Other" },
		],
		auth: "Bearer contract-token",
	});
	await vi.waitFor(() => expect(f.frames.some((frame) => frame.type === "hello")).toBe(true));
	privatePath(f.data);
	const file = join(f.data, "card-local.json");
	privatePath(file);
	expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ endpoint: f.endpoint, token: "contract-token" });
	expect(JSON.stringify([result, vi.mocked(f.api.log.warn).mock.calls, f.events])).not.toContain(code);
	expect(JSON.stringify([result, vi.mocked(f.api.log.warn).mock.calls, f.events])).not.toContain("contract-token");
	// A second device cannot reuse the code (404 invalid_code).
	const reused = await fetch(`${f.endpoint}/api/device/redeem`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ code, name: hostname(), kind: kind ?? "desktop" }),
	});
	expect(reused.status).toBe(404);
	expect(await reused.json()).toEqual({ error: "invalid_code" });
});

test.each(["unknown", "expired", "used"])(
	"invite contract: %s code maps to invalid-code without secrets",
	async (state) => {
		const f = await fixture();
		const code = state === "unknown" ? "9999999999" : await f.invite();
		if (state === "expired") f.invites.get(code)!.expiresAt = new Date(Date.now() - 1).toISOString();
		if (state === "used") f.invites.get(code)!.used = true;
		const result = await f.channel.login("poll", signal(), code);
		expect(result).toMatchObject({ status: "invalid-code", message: expect.stringContaining("重新") });
		expect(JSON.stringify([result, vi.mocked(f.api.log.warn).mock.calls])).not.toContain(code);
		expect(f.calls.filter((c) => c.path === "/api/device/redeem")).toHaveLength(1);
		expect(f.calls.some((c) => c.path === "/api/device/agents")).toBe(false);
		await expect(stat(join(f.data, "card-local.json"))).rejects.toMatchObject({ code: "ENOENT" });
	},
);

test("invite contract: 429 rate_limited maps to retry-later without consuming the invite", async () => {
	const f = await fixture();
	const code = await f.invite();
	f.setRateLimited();
	const result = await f.channel.login("start", signal(), code);
	expect(result).toMatchObject({ status: "retry-later", message: expect.stringContaining("稍后") });
	expect(f.invites.get(code)!.used).toBe(false);
	expect(JSON.stringify([result, vi.mocked(f.api.log.warn).mock.calls])).not.toContain(code);
	await expect(stat(join(f.data, "card-local.json"))).rejects.toMatchObject({ code: "ENOENT" });
});

test("invite contract: confirmed and restarted devices return already-connected without redeeming", async () => {
	const f = await fixture();
	await f.login();
	const code = await f.invite();
	for (const action of ["start", "poll"] as const) {
		expect(await f.channel.login(action, signal(), code)).toMatchObject({ status: "already-connected" });
	}
	await f.channel.stop();
	const restored = new CardChannel("card-local", { endpoint: f.endpoint }, f.api);
	cleanups.push(() => restored.stop());
	await restored.start({
		emit: async (event) => ({ ...event, id: "restored", ts: new Date().toISOString() }) as YEvent,
		ask: async () => {
			throw new Error("no ask");
		},
	});
	expect(await restored.login("poll", signal(), code)).toMatchObject({ status: "already-connected" });
	expect(f.calls.some((c) => c.path === "/api/device/redeem")).toBe(false);
	expect(f.invites.get(code)!.used).toBe(false);
});

test.each(["", "123", "12345678901", "abcdefghij"])(
	"invite contract: malformed code is rejected locally",
	async (code) => {
		const f = await fixture();
		expect(await f.channel.login("start", signal(), code)).toMatchObject({ status: "invalid-code" });
		expect(f.calls).toHaveLength(0);
	},
);
