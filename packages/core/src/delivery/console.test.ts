import type { Channel, SessionInfo, YEvent } from "@yonder/sdk";
import { expect, test } from "vitest";
import { resolveProfile } from "../config/test-support.js";
import { consoleChannel } from "../kernel/console.js";
import { openDatabase } from "../runtime/db.js";
import type { Runtime, RuntimeSessionConfig } from "../runtime/index.js";
import type { Sessions } from "../sessions/index.js";
import { createStore, newEvent } from "../store/index.js";
import { createDelivery } from "./index.js";

// Real SQLite store, ledger and delivery with the real built-in console channel; the Sessions seam records notifications.
async function setup(origin: "console" | "test" | Array<"console" | "test">) {
	const origins = Array.isArray(origin) ? origin : [origin];
	const db = await openDatabase(":memory:");
	const store = await createStore(db, () => "person:owner");
	const config: RuntimeSessionConfig = {
		agent: "main",
		profile: "owner",
		cwd: "/tmp",
		resolved: resolveProfile({}),
		bindings: [],
	};
	const session: SessionInfo = {
		id: "1",
		agent: "main",
		profile: "owner",
		mode: "main",
		key: "main",
		version: "check",
		opened: new Date().toISOString(),
	};
	await store.sessions.put(session);
	const events: YEvent[] = [];
	for (const item of origins) {
		const event = newEvent(
			{ type: "message.in", from: `acct:${item}:owner`, conv: `conv:${item}:main`, data: { text: "hi", kind: "dm" } },
			[{ agent: "main", session: "1", binding: "b", waiting: false }],
		);
		await store.events.append(event);
		events.push(event);
	}
	await store.identity().createPerson({ id: "owner", name: "owner" });
	await store.identity().link("acct:test:owner", "person:owner");
	// The console account is linked last, so it is the most recently seen one.
	await new Promise((resolve) => setTimeout(resolve, 10));
	await store.identity().link("acct:console:owner", "person:owner");
	const other: string[] = [];
	const test: Channel = {
		id: "test",
		kinds: ["dm"],
		output: { stream: false, attachments: false },
		async start() {},
		async stop() {},
		async send(_to, msg) {
			other.push(msg.text);
			return { ok: true };
		},
	};
	const notified: Array<{ id: string; event: string; text: string; from: string }> = [];
	const delivery = createDelivery({
		store,
		agents: new Map(),
		channels: new Map<string, Channel>([
			["console", consoleChannel()],
			["test", test],
		]),
		runtime: () => ({ currentConfig: () => config, authorizeAttachments: async () => {} }) as unknown as Runtime,
		sessions: {
			resolveSession: async () => config,
			notifyFrom: async (id: string, input: { event: string; text: string }, from: string) => {
				notified.push({ id, ...input, from });
				return { session: id, event: input.event, entry: 1, recorded: true };
			},
		} as unknown as Sessions,
	});
	const ctx = {
		session: "1",
		agent: "main",
		profile: "owner",
		event: events[0],
		events,
		capabilities: ["message"],
		channelInstances: undefined,
	};
	return { db, store, delivery, ctx, session, config, events, notified, other };
}

test("proactive owner messages skip the console account unless the turn came from the console", async () => {
	const x = await setup("test");
	try {
		const result = await x.delivery.sendTool(x.ctx as never, { to: "person:owner", text: "ping" });
		expect(result.ok).toBe(true);
		expect(x.other).toEqual(["ping"]);
		expect(x.notified).toEqual([]);
	} finally {
		await x.delivery.close();
		await x.db.close();
	}
});

test("a console-origin turn may target the console, and the message becomes a session event", async () => {
	const x = await setup("console");
	try {
		const result = await x.delivery.sendTool(x.ctx as never, { to: "conv:console:main", text: "hello owner" });
		expect(result.ok).toBe(true);
		expect(x.notified).toEqual([expect.objectContaining({ id: "1", text: "hello owner", from: "agent:main" })]);
	} finally {
		await x.delivery.close();
		await x.db.close();
	}
});

test("console delivery fails visibly when the Bot has no open main session", async () => {
	const x = await setup("console");
	try {
		await x.store.sessions.close("1");
		const result = await x.delivery.sendTool(x.ctx as never, { to: "conv:console:main", text: "lost" });
		expect(result.ok).toBe(false);
		expect(x.notified).toEqual([]);
	} finally {
		await x.delivery.close();
		await x.db.close();
	}
});

test("console remains authorized under a channel scope while other channels are rejected", async () => {
	const x = await setup("console");
	try {
		const ctx = { ...x.ctx, channelInstances: ["feishu"] };
		expect(
			await x.delivery.sendTool(ctx as never, { to: "conv:console:main", via: "console", text: "hello" }),
		).toMatchObject({ ok: true });
		expect(await x.delivery.sendTool(ctx as never, { to: "conv:test:main", text: "no" })).toMatchObject({
			ok: false,
			error: "Channel instance not authorized: test",
		});
	} finally {
		await x.delivery.close();
		await x.db.close();
	}
});

// A finished run whose inputs merged a channel message and a console message, as a steered turn does.
async function finishRun(x: Awaited<ReturnType<typeof setup>>, text = "answer") {
	x.delivery.start();
	const run = {
		runId: "run-1",
		status: "done" as const,
		text,
		usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, cost: 0 },
		inputs: x.events.map((event) => event.id),
		config: x.config,
	};
	const { ending, deliver } = await x.delivery.onRun(x.session, run, x.events);
	await x.store.events.recordRun(ending);
	deliver();
	await expect.poll(async () => (await outgoing(x)).length, { timeout: 5000 }).toBe(1);
	return (await x.store.events.query({ type: "run.end" })).events.at(-1);
}

const outgoing = async (x: Awaited<ReturnType<typeof setup>>) =>
	(await x.store.events.query({ type: "message.out" })).events.map((event) => [
		event.conv,
		(event.data as { delivery: { ok: boolean } }).delivery.ok,
	]);

test("a run carrying a console input answers only in the console", async () => {
	const x = await setup(["test", "console"]);
	try {
		const ended = await finishRun(x);
		expect(x.other).toEqual([]);
		expect(x.notified).toEqual([]);
		expect(ended?.data).toMatchObject({ replied: "source", targets: ["conv:console:main"] });
		expect(await outgoing(x)).toEqual([["conv:console:main", true]]);
	} finally {
		await x.delivery.close();
		await x.db.close();
	}
});

test("a console reply needs no channel authorization when the agent restricts instances", async () => {
	const x = await setup(["test", "console"]);
	try {
		x.config.resolved = resolveProfile({ channelInstances: ["test"] });
		const ended = await finishRun(x);
		expect(x.other).toEqual([]);
		expect(ended?.data).toMatchObject({ replied: "source", targets: ["conv:console:main"] });
		expect(await outgoing(x)).toEqual([["conv:console:main", true]]);
	} finally {
		await x.delivery.close();
		await x.db.close();
	}
});
