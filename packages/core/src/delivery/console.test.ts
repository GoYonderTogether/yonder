import type { Channel, SessionInfo } from "@yonder/sdk";
import { expect, test } from "vitest";
import { resolveProfile } from "../config/index.js";
import { consoleChannel } from "../kernel/console.js";
import { openDatabase } from "../runtime/db.js";
import type { Runtime, RuntimeSessionConfig } from "../runtime/index.js";
import type { Sessions } from "../sessions/index.js";
import { createStore, newEvent } from "../store/index.js";
import { createDelivery } from "./index.js";

// Real SQLite store, ledger and delivery with the real built-in console channel; the Sessions seam records notifications.
async function setup(origin: "console" | "test") {
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
	const event = newEvent(
		{ type: "message.in", from: `acct:${origin}:owner`, conv: `conv:${origin}:main`, data: { text: "hi", kind: "dm" } },
		[{ agent: "main", session: "1", binding: "b", waiting: false }],
	);
	await store.events.append(event);
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
		event,
		events: [event],
		capabilities: ["message"],
		channelInstances: undefined,
	};
	return { db, store, delivery, ctx, notified, other };
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
