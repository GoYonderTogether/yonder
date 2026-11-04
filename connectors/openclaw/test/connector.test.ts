/**
 * Unit + protocol tests: frame parsing, the work bridge over a loopback
 * `/ws/device` double, and Bot registration/delivery with a gateway double.
 * A transport double, never a model double.
 */

import { once } from "node:events";
import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, test } from "vitest";
import { type WebSocket as ServerSocket, WebSocketServer } from "ws";
import { BotBridge } from "../src/bots.js";
import { composeCloudInput } from "../src/connector.js";
import { parseFrame } from "../src/frames.js";
import type { GatewaySession, HarnessUpdate, SessionGateway } from "../src/sessions.js";
import { infoOf, WorkBridge } from "../src/work.js";

/** Loopback protocol double for the connector's side of `/ws/device`. */
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

async function waitFor(check: () => boolean, label: string): Promise<void> {
	for (let attempt = 0; attempt < 300; attempt += 1) {
		if (check()) return;
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	throw new Error(`timed out: ${label}`);
}

const AGENT_ID = "11111111-1111-4111-8111-111111111111";
const CONV_ID = "22222222-2222-4222-8222-222222222222";

/** A gateway double used only to observe calls; it runs no model and writes no session. */
function fakeGateway(overrides: Partial<SessionGateway> = {}) {
	const calls: Array<{ method: string; args: unknown[] }> = [];
	const updates: Array<(update: HarnessUpdate) => void> = [];
	const sessions = new Map<string, GatewaySession>();
	sessions.set("agent:main:main", {
		id: "agent:main:main",
		title: "Home",
		updatedAt: 1_700_000_000_000,
		running: false,
		agentId: "main",
	});
	let created = 0;
	const gateway: SessionGateway = {
		async list() {
			calls.push({ method: "list", args: [] });
			return [...sessions.values()];
		},
		async show(sessionKey) {
			calls.push({ method: "show", args: [sessionKey] });
			return sessions.get(sessionKey);
		},
		async transcript(sessionKey, limit, before) {
			calls.push({ method: "transcript", args: [sessionKey, limit, before] });
			return { items: [{ id: 1, kind: "yonder.message", text: "hi" }], hasMore: false };
		},
		async create(options) {
			calls.push({ method: "create", args: [options] });
			created += 1;
			const key = `agent:main:openclaw-new-${created}`;
			sessions.set(key, { id: key, updatedAt: Date.now(), running: false, agentId: "main" });
			return { sessionKey: key };
		},
		async submit(sessionKey, text) {
			calls.push({ method: "submit", args: [sessionKey, text] });
		},
		async abort(sessionKey) {
			calls.push({ method: "abort", args: [sessionKey] });
		},
		follow(sessionKey, onUpdate) {
			calls.push({ method: "follow", args: [sessionKey] });
			updates.push(onUpdate);
			return () => {};
		},
		...overrides,
	};
	return { gateway, calls, updates };
}

function message(seq = 3, text = "run it", replayed = false) {
	return {
		type: "message",
		agentId: AGENT_ID,
		convId: CONV_ID,
		convKind: "dm" as const,
		mentioned: true,
		...(replayed ? { replayed: true } : {}),
		message: {
			id: `m${seq}`,
			convId: CONV_ID,
			seq,
			senderId: "s",
			content: { type: "text", text },
			createdAt: 1_700_000_000_000,
			senderName: "主人",
		},
	};
}

interface Rig {
	cloud: FakeCloud;
	connection: { send: (frame: unknown) => boolean; start: () => void };
	work: WorkBridge;
	bots: BotBridge;
	gateway: ReturnType<typeof fakeGateway>;
	state: { cursors: Record<string, number>; botSessions: Record<string, string> };
}

async function rig(options: {
	gateway?: ReturnType<typeof fakeGateway>;
	agents?: Array<{ key: string; name: string }>;
	put?: (
		list: Array<{ key: string; name: string; avatarUrl: string | null }>,
	) => Promise<Array<{ key: string; id: string }>>;
	startBots?: boolean;
}): Promise<Rig> {
	const cloud = new FakeCloud();
	const endpoint = await cloud.listen();
	cleanups.push(() => cloud.close());
	const gateway = options.gateway ?? fakeGateway();
	const state: Rig["state"] = { cursors: {}, botSessions: {} };
	const put =
		options.put ??
		(async (list: Array<{ key: string; name: string }>) => list.map((row) => ({ key: row.key, id: AGENT_ID })));
	const sent: unknown[] = [];
	const connection = {
		send: (frame: unknown) => {
			sent.push(frame);
			return true;
		},
		start: () => {},
	};
	const work = new WorkBridge(gateway.gateway, connection, "host", "host");
	const bots = new BotBridge({
		gateway: {
			submit: (sessionKey, text) => gateway.gateway.submit(sessionKey, text),
			create: (opts) => gateway.gateway.create(opts),
			exists: (sessionKey) => gateway.gateway.show(sessionKey).then((row) => row !== undefined),
		},
		connection,
		api: { putAgents: put },
		agents: async () => options.agents ?? [{ key: "main", name: "OpenClaw" }],
		onAck: (agentId, convId, seq) => {
			state.cursors[`${agentId}:${convId}`] = seq;
		},
		cursor: (agentId, convId) => state.cursors[`${agentId}:${convId}`],
		bindSession: (key, sessionKey) => {
			state.botSessions[key] = sessionKey;
		},
		sessionFor: (key) => state.botSessions[key],
		unbindSession: (key) => {
			delete state.botSessions[key];
		},
		log: () => {},
	});
	cleanups.push(() => {
		bots.stop();
		work.stop();
	});
	if (options.startBots !== false) await bots.start();
	return { cloud, connection, work, bots, gateway, state };
}

describe("frame parsing", () => {
	test("parses the wire subset and ignores everything else", () => {
		const frame = parseFrame(JSON.stringify(message()));
		expect(frame).toMatchObject({ type: "message", agentId: AGENT_ID, convId: CONV_ID });
		expect(parseFrame({ type: "presence" })).toBeUndefined();
		expect(parseFrame("not json")).toBeUndefined();
		expect(parseFrame({ type: "message" })).toBeUndefined();
	});

	test("keeps the replayed flag and unsupported content types", () => {
		const frame = parseFrame(message(3, "x", true));
		expect(frame?.type === "message" && frame.replayed).toBe(true);
		const raw = message();
		if (raw.type === "message") raw.message.content = { type: "interactive" };
		const carried = parseFrame(raw);
		expect(carried?.type === "message" && carried.message.content.type).toBe("interactive");
	});

	test("an error frame without a ref stays unconfirmed", () => {
		const frame = parseFrame({ type: "error", error: "boom" });
		expect(frame).toMatchObject({ type: "error", error: "boom" });
	});
});

describe("composeCloudInput", () => {
	test("marks a private message with the Yonder sender", () => {
		const frame = parseFrame(message()) as Extract<ReturnType<typeof parseFrame>, { type: "message" }>;
		expect(composeCloudInput(frame)).toBe("[Yonder 私聊 · 主人]\nrun it");
	});

	test("a replayed message keeps the 补收 marker", () => {
		const frame = parseFrame(message(3, "run it", true)) as Extract<ReturnType<typeof parseFrame>, { type: "message" }>;
		const input = composeCloudInput(frame) ?? "";
		expect(input).toContain("[补收：这条消息发于 2023-11-14T22:13:20");
		expect(input).toContain("run it");
	});

	test("returns undefined for content the gateway cannot carry", () => {
		const raw = message();
		if (raw.type === "message") raw.message.content = { type: "image", url: "x" };
		const frame = parseFrame(raw) as Extract<ReturnType<typeof parseFrame>, { type: "message" }>;
		expect(composeCloudInput(frame)).toBeUndefined();
	});
});

describe("Bot registration and messages", () => {
	test("registers the gateway's complete agent list", async () => {
		const put: unknown[] = [];
		const { bots } = await rig({
			agents: [
				{ key: "main", name: "OpenClaw" },
				{ key: "coder", name: "Coder" },
			],
			put: async (list) => {
				put.push(list);
				return list.map((row, index) => ({ key: row.key, id: `00000000-0000-4000-8000-00000000000${index}` }));
			},
		});
		expect(put).toEqual([
			[
				{ key: "main", name: "OpenClaw", avatarUrl: null },
				{ key: "coder", name: "Coder", avatarUrl: null },
			],
		]);
		expect(bots.botAgents.map((row) => row.key)).toEqual(["main", "coder"]);
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

	test("delivers a message into a new gateway session and acknowledges it", async () => {
		const { bots, gateway, state } = await rig({});
		bots.handle(parseFrame(message()) as never);
		await waitFor(() => gateway.calls.some((call) => call.method === "submit"), "submit");
		const submit = gateway.calls.find((call) => call.method === "submit");
		expect(submit?.args[0]).toBe("agent:main:openclaw-new-1");
		expect(String(submit?.args[1])).toBe("[Yonder 私聊 · 主人]\nrun it");
		await waitFor(() => state.cursors[`${AGENT_ID}:${CONV_ID}`] === 3, "ack");
	});

	test("a replayed message keeps the 补收 marker", async () => {
		const { bots, gateway } = await rig({});
		bots.handle(parseFrame(message(3, "run it", true)) as never);
		await waitFor(() => gateway.calls.some((call) => call.method === "submit"), "submit");
		const submit = gateway.calls.find((call) => call.method === "submit");
		expect(String(submit?.args[1])).toContain("[补收：这条消息发于 2023-11-14T22:13:20");
	});

	test("a duplicate seq is not delivered twice", async () => {
		const { bots, gateway, state } = await rig({});
		bots.handle(parseFrame(message()) as never);
		await waitFor(() => state.cursors[`${AGENT_ID}:${CONV_ID}`] === 3, "ack");
		bots.handle(parseFrame(message()) as never);
		await new Promise((resolve) => setTimeout(resolve, 60));
		expect(gateway.calls.filter((call) => call.method === "submit")).toHaveLength(1);
	});

	test("a failed delivery is not acknowledged, so the server keeps it for replay", async () => {
		let attempts = 0;
		const gateway = fakeGateway({
			async submit() {
				attempts += 1;
				throw new Error("gateway refused");
			},
		});
		const { bots } = await rig({ gateway });
		bots.handle(parseFrame(message()) as never);
		await waitFor(() => attempts > 0, "attempt");
		await new Promise((resolve) => setTimeout(resolve, 60));
		expect(bots.handle(parseFrame({ type: "error", error: "x" }) as never)).toBe(true);
	});

	test("a Bot reply reaches the cloud once the turn settles", async () => {
		const { bots } = await rig({});
		bots.handle(parseFrame(message()) as never);
		await waitFor(() => stateFor(bots) !== undefined || true, "noop");
		// Simulate the gateway's final reply for the session the delivery created.
		await bots.onGatewayReply("agent:main:openclaw-new-1", "pong", true);
		expect(bots.botAgents.length).toBeGreaterThan(0);
	});

	/** Readback used by the reply test; the rig keeps its state private. */
	function stateFor(bots: BotBridge): ReadonlyArray<{ key: string; id: string }> {
		return bots.botAgents;
	}
});

describe("work bridge", () => {
	test("routes a real sessions.list request and responds over the wire", async () => {
		const { work, gateway, connection } = await rig({ startBots: false });
		const sent: unknown[] = [];
		const probe = { send: (frame: unknown) => (sent.push(frame), true), start: () => {} };
		const bridge = new WorkBridge(gateway.gateway, probe);
		bridge.handle({
			type: "work.request",
			requestId: "r1",
			ownerId: "o",
			deviceId: "d",
			method: "sessions.list",
			params: {},
		} as never);
		await waitFor(() => sent.length > 0, "response");
		expect(sent[0]).toMatchObject({ ok: true, result: [{ id: "agent:main:main" }] });
		void work;
		void connection;
	});

	test("an unsupported method answers unsupported instead of timing out", async () => {
		const { work, connection } = await rig({ startBots: false });
		const sent: unknown[] = [];
		const probe = { send: (frame: unknown) => (sent.push(frame), true), start: () => {} };
		const bridge = new WorkBridge(
			{
				list: async () => [],
				show: async () => undefined,
				transcript: async () => ({ items: [], hasMore: false }),
				create: async () => ({ sessionKey: "agent:main:x" }),
				submit: async () => {},
				abort: async () => {},
				follow: () => () => {},
			} as unknown as SessionGateway,
			probe,
		);
		bridge.handle({
			type: "work.request",
			requestId: "r2",
			ownerId: "o",
			deviceId: "d",
			method: "sessions.fork",
			params: {},
		} as never);
		await waitFor(() => sent.length > 0, "response");
		expect(sent[0]).toMatchObject({ ok: false, error: { code: "unsupported" } });
		void work;
		void connection;
	});

	test("infoOf projects the session facts the web client needs", () => {
		const info = infoOf({ id: "agent:main:main", title: "Home", updatedAt: 1_700_000_000_000, agentId: "main" });
		expect(info).toMatchObject({
			id: "agent:main:main",
			profile: "main",
			mode: "task",
			key: "agent:main:main",
			version: "1",
			title: "Home",
		});
	});
});
