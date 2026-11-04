import { once } from "node:events";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { type WebSocket as ServerSocket, WebSocketServer } from "ws";
import type { HarnessService, HarnessUpdate } from "../src/adapter.js";
import { BotBridge } from "../src/bots.js";
import { CloudConnection } from "../src/connection.js";
import { type InboundFrame, parseFrame } from "../src/frames.js";
import { WorkBridge } from "../src/work.js";

/**
 * Loopback protocol double for the connector's side of `/ws/device`. It speaks the frames
 * the real cloud server sends; it is a transport double, never a model double.
 */
class FakeCloud {
	readonly frames: Record<string, unknown>[] = [];
	readonly paths: string[] = [];
	readonly auth: string[] = [];
	sockets = 0;
	client: ServerSocket | undefined;
	private readonly server: Server;
	private readonly wss: WebSocketServer;
	constructor() {
		this.server = createServer();
		this.wss = new WebSocketServer({ noServer: true });
		this.server.on("upgrade", (request, socket, head) => {
			this.paths.push(request.url ?? "");
			this.auth.push(request.headers.authorization ?? "");
			this.wss.handleUpgrade(request, socket, head, (ws) => {
				this.sockets += 1;
				this.client = ws;
				ws.on("message", (data) => this.frames.push(JSON.parse(String(data)) as Record<string, unknown>));
			});
		});
	}
	async listen(): Promise<string> {
		this.server.listen(0, "127.0.0.1");
		await once(this.server, "listening");
		const { port } = this.server.address() as { port: number };
		return `http://127.0.0.1:${port}`;
	}
	push(value: unknown): void {
		this.client?.send(JSON.stringify(value));
	}
	async close(): Promise<void> {
		for (const client of this.wss.clients) client.terminate();
		this.wss.close();
		await new Promise<void>((resolve) => this.server.close(() => resolve()));
	}
}

const cleanups: (() => Promise<unknown> | unknown)[] = [];
afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

/** A harness double used only to observe calls; it runs no model and writes no session. */
function fakeHarness(overrides: Partial<HarnessService> = {}) {
	const calls: Array<{ method: string; args: unknown[] }> = [];
	const updates: Array<(update: HarnessUpdate) => void> = [];
	const sessions = new Map<
		string,
		{ id: string; title?: string; updatedAt: number; running: boolean; blank: boolean }
	>();
	sessions.set("session-1", {
		id: "session-1",
		title: "Existing",
		updatedAt: 1_700_000_000_000,
		running: false,
		blank: false,
	});
	let created = 0;
	const harness: HarnessService = {
		async list() {
			calls.push({ method: "list", args: [] });
			return [...sessions.values()].map((row) => ({ ...row, agentPreset: "standard" }));
		},
		async show(id) {
			calls.push({ method: "show", args: [id] });
			const row = sessions.get(id);
			return row ? { ...row, agentPreset: "standard" } : undefined;
		},
		async transcript(id, range) {
			calls.push({ method: "transcript", args: [id, range] });
			return { items: [{ id: 1, kind: "yonder.message", text: "hi" }], hasMore: false };
		},
		async create(options) {
			calls.push({ method: "create", args: [options] });
			created += 1;
			const id = `session-new-${created}`;
			sessions.set(id, { id, updatedAt: Date.now(), running: false, blank: true });
			return { sessionId: id };
		},
		async submit(id, text) {
			calls.push({ method: "submit", args: [id, text] });
			return { accepted: true };
		},
		async abort(id) {
			calls.push({ method: "abort", args: [id] });
		},
		async follow(id, onUpdate) {
			calls.push({ method: "follow", args: [id] });
			updates.push(onUpdate);
			return async () => {};
		},
		defaultPreset: () => "standard",
		...overrides,
	};
	return { harness, calls, updates };
}

async function waitFor(check: () => boolean, label: string): Promise<void> {
	for (let attempt = 0; attempt < 300; attempt += 1) {
		if (check()) return;
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	throw new Error(`timed out: ${label}`);
}

const AGENT_ID = "11111111-1111-4111-8111-111111111111";
const CONV_ID = "22222222-2222-4222-8222-222222222222";

interface Rig {
	cloud: FakeCloud;
	socket: CloudConnection;
	bots: BotBridge;
	work: WorkBridge;
	harness: ReturnType<typeof fakeHarness>;
	state: { cursors: Record<string, number>; botSessions: Record<string, string> };
}

/** Wire the connector's three parts to one loopback cloud. */
async function rig(options: {
	harness?: ReturnType<typeof fakeHarness>;
	agents?: Array<{ key: string; name: string }>;
	put?: (
		list: Array<{ key: string; name: string; avatarUrl: string | null }>,
	) => Promise<Array<{ key: string; id: string }>>;
	startBots?: boolean;
}): Promise<Rig> {
	const cloud = new FakeCloud();
	const endpoint = await cloud.listen();
	cleanups.push(() => cloud.close());
	const harness = options.harness ?? fakeHarness();
	const state: { cursors: Record<string, number>; botSessions: Record<string, string> } = {
		cursors: {},
		botSessions: {},
	};
	const put =
		options.put ??
		(async (list: Array<{ key: string; name: string }>) => list.map((row) => ({ key: row.key, id: AGENT_ID })));
	let bots: BotBridge;
	let work: WorkBridge;
	const socket = new CloudConnection({
		endpoint,
		deviceToken: "token-abc",
		onFrame: (raw) => {
			const frame = parseFrame(raw);
			if (!frame) return;
			if (!bots.handle(frame)) work.handle(frame);
		},
	});
	bots = new BotBridge({
		harness: harness.harness,
		connection: socket,
		api: { putAgents: put },
		agents: () => options.agents ?? [{ key: "standard", name: "host" }],
		onAck: (agentId, convId, seq) => {
			state.cursors[`${agentId}:${convId}`] = seq;
		},
		cursor: (agentId, convId) => state.cursors[`${agentId}:${convId}`],
		bindSession: (key, sessionId) => {
			state.botSessions[key] = sessionId;
		},
		sessionFor: (key) => state.botSessions[key],
		unbindSession: (key) => {
			delete state.botSessions[key];
		},
		log: () => {},
	});
	work = new WorkBridge(harness.harness, socket, "host", "host");
	cleanups.push(() => {
		bots.stop();
		work.stop();
		socket.stop();
	});
	if (options.startBots !== false) await bots.start();
	else socket.start();
	await waitFor(() => cloud.sockets === 1, "socket");
	return { cloud, socket, bots, work, harness, state };
}

const message = (seq = 3, text = "run it") => ({
	type: "message",
	agentId: AGENT_ID,
	convId: CONV_ID,
	convKind: "dm",
	mentioned: true,
	message: {
		id: `m${seq}`,
		convId: CONV_ID,
		seq,
		senderId: "s",
		content: { type: "text", text },
		createdAt: 1_700_000_000_000,
		senderName: "主人",
	},
});

describe("device connection", () => {
	test("connects outbound to /ws/device with the device token and never listens", async () => {
		const cloud = new FakeCloud();
		const endpoint = await cloud.listen();
		cleanups.push(() => cloud.close());
		const socket = new CloudConnection({ endpoint, deviceToken: "token-abc", onFrame: () => {} });
		cleanups.push(() => socket.stop());
		socket.start();
		await waitFor(() => cloud.sockets === 1, "socket");
		expect(cloud.paths[0]).toBe("/ws/device");
		expect(cloud.auth[0]).toBe("Bearer token-abc");
		expect(socket.send({ type: "hello", workProtocol: 1 })).toBe(true);
		await waitFor(() => cloud.frames.length > 0, "hello");
		expect(cloud.frames[0]).toEqual({ type: "hello", workProtocol: 1 });
	});

	test("a non-loopback HTTP endpoint degrades instead of throwing", () => {
		const reasons: string[] = [];
		const socket = new CloudConnection({
			endpoint: "http://example.com",
			deviceToken: "t",
			onFrame: () => {},
			onClose: (value) => reasons.push(value),
		});
		cleanups.push(() => socket.stop());
		expect(() => socket.start()).not.toThrow();
		expect(socket.connected).toBe(false);
		expect(reasons).toContain("invalid endpoint");
	});
});

describe("Bot registration and messages", () => {
	test("registers the harness's complete agent list", async () => {
		const put: unknown[] = [];
		const { bots } = await rig({
			agents: [
				{ key: "standard", name: "host" },
				{ key: "cordis", name: "host · cordis" },
			],
			put: async (list) => {
				put.push(list);
				return list.map((row, index) => ({ key: row.key, id: `00000000-0000-4000-8000-00000000000${index}` }));
			},
		});
		expect(put).toEqual([
			[
				{ key: "standard", name: "host", avatarUrl: null },
				{ key: "cordis", name: "host · cordis", avatarUrl: null },
			],
		]);
		expect(bots.botAgents.map((row) => row.key)).toEqual(["standard", "cordis"]);
	});

	test("an empty agent list never retires every Bot", async () => {
		const put: unknown[] = [];
		await rig({
			agents: [],
			put: async (list) => {
				put.push(list);
				return [];
			},
		});
		expect(put).toEqual([]);
	});

	test("delivers a message into a new harness session and acknowledges it", async () => {
		const { cloud, bots, harness, state } = await rig({});
		bots.handle(parseFrame(message()) as InboundFrame);
		await waitFor(() => cloud.frames.some((item) => item.type === "ack"), "ack");
		expect(harness.calls.filter((call) => call.method === "submit")).toEqual([
			{ method: "submit", args: ["session-new-1", "[Yonder 私聊 · 主人]\nrun it"] },
		]);
		expect(cloud.frames.find((item) => item.type === "ack")).toMatchObject({
			seq: 3,
			agentId: AGENT_ID,
			convId: CONV_ID,
		});
		expect(state.cursors[`${AGENT_ID}:${CONV_ID}`]).toBe(3);
	});

	test("a replayed message keeps the 补收 marker", async () => {
		const { bots, harness } = await rig({});
		bots.handle(parseFrame({ ...message(), replayed: true }) as InboundFrame);
		await waitFor(() => harness.calls.some((call) => call.method === "submit"), "submit");
		expect(String(harness.calls.find((call) => call.method === "submit")?.args[1])).toContain(
			"[补收：这条消息发于 2023-11-14T22:13:20.000Z",
		);
	});

	test("a message whose seq was already accepted is not delivered twice", async () => {
		const { bots, harness } = await rig({});
		bots.handle(parseFrame(message()) as InboundFrame);
		await waitFor(() => harness.calls.some((call) => call.method === "submit"), "first submit");
		bots.handle(parseFrame(message()) as InboundFrame);
		await new Promise((resolve) => setTimeout(resolve, 60));
		expect(harness.calls.filter((call) => call.method === "submit")).toHaveLength(1);
	});

	test("a failed delivery is not acknowledged, so the server keeps it for replay", async () => {
		let attempts = 0;
		const harness = fakeHarness({
			async submit() {
				attempts += 1;
				throw new Error("harness refused");
			},
		});
		const { cloud, bots } = await rig({ harness });
		bots.handle(parseFrame(message()) as InboundFrame);
		await waitFor(() => attempts > 0, "submit attempt");
		await new Promise((resolve) => setTimeout(resolve, 60));
		expect(cloud.frames.some((item) => item.type === "ack")).toBe(false);
	});

	test("content the harness cannot carry is acknowledged and reported in the conversation", async () => {
		const { cloud, bots } = await rig({});
		bots.handle(
			parseFrame({
				...message(),
				message: {
					...message().message,
					content: { type: "interactive", title: "t", body: "b", state: "pending", actions: [] },
				},
			}) as InboundFrame,
		);
		await waitFor(() => cloud.frames.some((item) => item.type === "send"), "send");
		expect(cloud.frames.some((item) => item.type === "ack")).toBe(true);
		expect(cloud.frames.find((item) => item.type === "send")).toMatchObject({ content: { type: "text" } });
	});

	test("the Bot reply reaches the cloud only after `sent`", async () => {
		const { cloud, bots, state } = await rig({});
		bots.handle(parseFrame(message()) as InboundFrame);
		await waitFor(() => state.botSessions.standard !== undefined, "session binding");
		const sessionId = state.botSessions.standard ?? "";
		await bots.onHarnessEvent({
			sessionId,
			seq: 20,
			type: "assistant/message",
			time: 1,
			data: { message: { content: [{ type: "text", text: "pong" }] } },
		});
		void bots.onHarnessEvent({
			sessionId,
			seq: 21,
			type: "turn/end",
			time: 1,
			data: { reason: { kind: "completed" } },
		});
		await waitFor(() => cloud.frames.some((item) => item.type === "send"), "send frame");
		const send = cloud.frames.find((item) => item.type === "send");
		expect(send).toMatchObject({ agentId: AGENT_ID, convId: CONV_ID, content: { type: "markdown", text: "pong" } });
		cloud.push({ type: "sent", ref: send?.ref, message: { id: "reply-1" } });
		await new Promise((resolve) => setTimeout(resolve, 30));
	});

	test("an unacknowledged reply is never retried automatically", async () => {
		const { cloud, bots, state } = await rig({});
		bots.handle(parseFrame(message()) as InboundFrame);
		await waitFor(() => state.botSessions.standard !== undefined, "session binding");
		const sessionId = state.botSessions.standard ?? "";
		await bots.onHarnessEvent({
			sessionId,
			seq: 20,
			type: "assistant/message",
			time: 1,
			data: { message: { content: [{ type: "text", text: "pong" }] } },
		});
		await bots.onHarnessEvent({
			sessionId,
			seq: 21,
			type: "turn/end",
			time: 1,
			data: { reason: { kind: "completed" } },
		});
		await waitFor(() => cloud.frames.some((item) => item.type === "send"), "send frame");
		// The cloud answers `error` with no ref, which cannot confirm the send.
		cloud.push({ type: "error", error: "forbidden" });
		await new Promise((resolve) => setTimeout(resolve, 60));
		expect(cloud.frames.filter((item) => item.type === "send")).toHaveLength(1);
	});
});

describe("work methods", () => {
	test("answers each implemented method and refuses the rest explicitly", async () => {
		const { cloud, work } = await rig({ startBots: false });
		const request = (requestId: string, method: string, params: unknown) =>
			work.handle({ type: "work.request", requestId, ownerId: "o", deviceId: "d", method, params });
		request("r1", "sessions.list", {});
		request("r2", "sessions.transcript", { id: "session-1", limit: 10 });
		request("r3", "sessions.submit", { id: "session-1", text: "hi" });
		request("r4", "sessions.abort", { id: "session-1" });
		request("r5", "sessions.open", { id: "session-1" });
		request("r6", "sessions.fork", { id: "session-1", at: 1 });
		request("r7", "tools.call", {});
		request("r8", "sessions.submit", { id: "session-1", text: "   " });
		await waitFor(() => cloud.frames.filter((item) => item.type === "work.response").length === 8, "responses");
		const responses = new Map(
			cloud.frames.filter((item) => item.type === "work.response").map((item) => [item.requestId, item]),
		);
		expect(responses.get("r1")).toMatchObject({
			ok: true,
			result: [expect.objectContaining({ id: "session-1", title: "Existing", mode: "task" })],
		});
		expect(responses.get("r2")).toMatchObject({
			ok: true,
			result: { items: [expect.objectContaining({ id: 1 })], hasMore: false },
		});
		expect(responses.get("r3")).toMatchObject({ ok: true, result: { session: "session-1" } });
		expect(responses.get("r4")).toMatchObject({ ok: true, result: { ok: true } });
		expect(responses.get("r5")).toMatchObject({ ok: true, result: expect.objectContaining({ id: "session-1" }) });
		expect(responses.get("r6")).toMatchObject({ ok: false, error: { code: "unsupported" } });
		expect(responses.get("r7")).toMatchObject({ ok: false, error: { code: "unsupported" } });
		expect(responses.get("r8")).toMatchObject({ ok: false, error: { code: "invalid_params" } });
	});

	test("sessions.open without an id creates a harness session", async () => {
		const { cloud, work, harness } = await rig({ startBots: false });
		work.handle({
			type: "work.request",
			requestId: "o1",
			ownerId: "o",
			deviceId: "d",
			method: "sessions.open",
			params: { preset: "cordis" },
		});
		await waitFor(() => cloud.frames.some((item) => item.type === "work.response"), "response");
		expect(harness.calls.find((call) => call.method === "create")?.args[0]).toEqual({ preset: "cordis" });
		expect(cloud.frames.find((item) => item.type === "work.response")).toMatchObject({
			ok: true,
			result: expect.objectContaining({ id: "session-new-1" }),
		});
	});

	test("capabilities.get reports only the methods this connector implements", async () => {
		const { cloud, work } = await rig({ startBots: false });
		work.handle({
			type: "work.request",
			requestId: "c1",
			ownerId: "o",
			deviceId: "d",
			method: "capabilities.get",
			params: {},
		});
		await waitFor(() => cloud.frames.some((item) => item.type === "work.response"), "response");
		const response = cloud.frames.find((item) => item.type === "work.response") as {
			result: { methods: Record<string, unknown> };
		};
		expect(Object.keys(response.result.methods).sort()).toEqual([
			"capabilities.get",
			"sessions.abort",
			"sessions.list",
			"sessions.open",
			"sessions.submit",
			"sessions.transcript",
			"sessions.watch",
		]);
		// No device-execution method exists, so this cannot become a path around pairing/grant.
		expect(Object.keys(response.result.methods).some((name) => name.startsWith("tools."))).toBe(false);
	});

	test("a subscription opens with a gap-marked snapshot and relays harness updates", async () => {
		const { cloud, work, harness } = await rig({ startBots: false });
		work.handle({ type: "work.open", channelId: "ch1", ownerId: "o", deviceId: "d" });
		work.handle({
			type: "work.frame",
			channelId: "ch1",
			ownerId: "o",
			deviceId: "d",
			frame: { t: "sub", sub: "s1", method: "sessions.watch", params: { id: "session-1" } },
		});
		await waitFor(() => cloud.frames.some((item) => (item.frame as { t?: string })?.t === "ready"), "ready");
		expect(cloud.frames.find((item) => (item.frame as { t?: string })?.t === "ready")?.frame).toMatchObject({
			t: "ready",
			gap: true,
			result: { transcript: { items: [{ id: 1 }] } },
		});
		harness.updates[0]?.({ type: "state", running: true });
		await waitFor(() => cloud.frames.some((item) => (item.frame as { t?: string })?.t === "ev"), "event");
		expect(cloud.frames.find((item) => (item.frame as { t?: string })?.t === "ev")?.frame).toMatchObject({
			type: "session.update",
			data: { type: "state", running: true },
		});
		work.handle({ type: "work.frame", channelId: "ch1", ownerId: "o", deviceId: "d", frame: { t: "ping", n: 7 } });
		await waitFor(() => cloud.frames.some((item) => (item.frame as { t?: string })?.t === "pong"), "pong");
		expect(cloud.frames.find((item) => (item.frame as { t?: string })?.t === "pong")?.frame).toEqual({
			t: "pong",
			n: 7,
		});
		work.handle({
			type: "work.frame",
			channelId: "ch1",
			ownerId: "o",
			deviceId: "d",
			frame: { t: "sub", sub: "s2", method: "views.watch" },
		});
		await waitFor(
			() => cloud.frames.some((item) => (item.frame as { sub?: string; reason?: string })?.sub === "s2"),
			"unsupported end",
		);
		expect(cloud.frames.find((item) => (item.frame as { sub?: string })?.sub === "s2")?.frame).toMatchObject({
			t: "end",
			reason: "error",
			error: { code: "unsupported" },
		});
		work.handle({ type: "work.close", channelId: "ch1", ownerId: "o", deviceId: "d" });
	});

	test("a subscription to an unknown session ends with not_found", async () => {
		const { cloud, work } = await rig({ startBots: false });
		work.handle({ type: "work.open", channelId: "ch1", ownerId: "o", deviceId: "d" });
		work.handle({
			type: "work.frame",
			channelId: "ch1",
			ownerId: "o",
			deviceId: "d",
			frame: { t: "sub", sub: "s1", method: "sessions.watch", params: { id: "session-missing" } },
		});
		await waitFor(() => cloud.frames.some((item) => (item.frame as { t?: string })?.t === "end"), "end");
		expect(cloud.frames.find((item) => (item.frame as { t?: string })?.t === "end")?.frame).toMatchObject({
			reason: "error",
			error: { code: "not_found" },
		});
	});
});

describe("state isolation", () => {
	test("the bridges write no files themselves; state goes through the injected callbacks", async () => {
		const dir = mkdtempSync(join(tmpdir(), "yonder-dsh-"));
		cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
		const before = process.cwd();
		const { bots } = await rig({});
		bots.handle(parseFrame(message()) as InboundFrame);
		await waitFor(() => true, "noop");
		// Neither the bridge nor the connection changes the working directory or writes under it.
		expect(process.cwd()).toBe(before);
		expect(readdirSync(dir)).toEqual([]);
	});
});
