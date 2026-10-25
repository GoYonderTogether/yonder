import type { Channel, Delivery, Hook, ToolContext } from "@yonder/sdk";
import { expect, test, vi } from "vitest";
import { resolveProfile } from "../config/index.js";
import { openDatabase } from "../runtime/db.js";
import type { Runtime, RuntimeSessionConfig, RuntimeSessionState } from "../runtime/index.js";
import type { Sessions } from "../sessions/index.js";
import { createStore } from "../store/index.js";
import { createCoreTools } from "../tools/index.js";
import { createDelivery } from "./index.js";

// Protocol driver, real local identity/receipt store, no model or real platform.
async function setup(hook?: Hook) {
	const db = await openDatabase(":memory:");
	const store = await createStore(db);
	const session = {
		id: "1",
		agent: "scope-a",
		profile: "owner",
		mode: "main" as const,
		key: "main",
		version: "check",
		opened: new Date().toISOString(),
	};
	await store.sessions.put(session);
	await store.identity().createPerson({ id: "owner", name: "Scope fixture" });
	for (const id of ["a", "b"]) await store.identity().link(`acct:${id}:user`, "person:owner");
	await db.run("UPDATE y_accounts SET lastSeen = ? WHERE ref = ?", "2099-01-01", "acct:b:user");
	const config: RuntimeSessionConfig = {
		agent: "scope-a",
		profile: "owner",
		cwd: process.cwd(),
		owner: "person:owner",
		resolved: resolveProfile({ level: "bypass", channelInstances: ["a"], plugins: hook ? ["scope-hook"] : [] }),
	};
	const saved = new Map<string, RuntimeSessionState>();
	const runtime = {
		currentConfig: () => config,
		sessionConfig: async () => config,
		authorizeAttachments: vi.fn(async () => {}),
		sessionState: async (id: string) => saved.get(id),
		setSessionState: async (id: string, state: RuntimeSessionState) => {
			saved.set(id, structuredClone(state));
		},
		// Stop immediately after native task initialization; never synthesize a model answer.
		runTask: async (_ctx: ToolContext, initialize: (id: string) => Promise<unknown>) => {
			await initialize("2");
			throw new Error("Protocol initialization complete; no model started");
		},
	} as unknown as Runtime;
	const sessions = { version: "check", resolveSession: async () => config } as unknown as Sessions;
	const counters = ["a", "b"].map((id) => ({
		id,
		send: vi.fn(async (_to: string, _msg: unknown): Promise<Delivery> => ({ ok: true })),
	}));
	const channels = new Map(
		counters.map(({ id, send }) => [
			id,
			{
				id,
				send,
				kinds: ["dm"],
				output: { stream: false, attachments: false },
				start: async () => {},
				stop: async () => {},
			} as Channel,
		]),
	);
	const delivery = createDelivery({
		store,
		agents: new Map(),
		channels,
		runtime: () => runtime,
		sessions,
		...(hook ? { hooks: new Map([["scope-hook", [hook]]]) } : {}),
	});
	delivery.start();
	const tools = createCoreTools({
		store,
		agents: new Map(),
		sessions,
		runtime: () => runtime,
		delivery,
		ask: async () => {
			throw new Error("No model in protocol tests");
		},
		getPreset: () => ({ id: "child", description: "Scope child", channelInstances: ["b"] }),
	});
	const ctx = {
		agent: session.agent,
		profile: session.profile,
		session: session.id,
		capabilities: config.resolved.capabilities,
		channelInstances: ["a"],
		signal: new AbortController().signal,
	} as ToolContext;
	return { db, store, delivery, counters, ctx, tools, saved, config, session };
}

test("generic send and message_send reject B before platform access, including admin and source B", async () => {
	const x = await setup();
	try {
		for (const request of [
			{ to: "conv:b:chat", text: "scope test" },
			{ to: "person:owner", via: "b", text: "scope test" },
			{ to: "owner", via: "b", text: "scope test" },
		]) {
			const ctx = {
				...x.ctx,
				event: { id: "source", type: "message.in", ts: new Date().toISOString(), conv: "conv:b:chat", data: {} },
			};
			expect(await x.delivery.sendTool(ctx, request)).toMatchObject({
				ok: false,
				error: expect.stringContaining("not authorized"),
			});
			expect(await x.tools.find((t) => t.name === "message_send")!.execute(request, ctx)).toMatchObject({
				isError: true,
			});
		}
		for (const counter of x.counters) expect(counter.send).not.toHaveBeenCalled();
	} finally {
		await x.delivery.close();
		await x.db.close();
	}
});

test("owner/person candidates filtered before recent account selection; no-event and A+B work; message check preserved", async () => {
	const x = await setup();
	try {
		for (const to of ["owner", "person:owner", "conv:a:chat"])
			expect(await x.delivery.sendTool(x.ctx, { to, text: "scope test" })).toMatchObject({ ok: true });
		expect(x.counters[0]!.send.mock.calls[0]?.[0]).toBe("acct:a:user");
		expect(x.counters[1]!.send).not.toHaveBeenCalled();
		expect(
			await x.delivery.sendTool({ ...x.ctx, channelInstances: ["a", "b"] }, { to: "person:owner", text: "multi" }),
		).toMatchObject({ ok: true });
		expect(x.counters[1]!.send.mock.calls[0]?.[0]).toBe("acct:b:user");
		expect(
			await x.delivery.sendTool({ ...x.ctx, channelInstances: [] }, { to: "conv:a:chat", text: "none" }),
		).toMatchObject({ ok: false });
		expect(
			await x.delivery.sendTool({ ...x.ctx, capabilities: [] }, { to: "conv:a:chat", text: "no capability" }),
		).toMatchObject({ ok: false, error: expect.stringContaining("message") });
		const event = { id: "source", type: "message.in", ts: new Date().toISOString(), conv: "conv:a:chat", data: {} };
		expect(
			await x.delivery.sendTool({ ...x.ctx, capabilities: [], events: [event] }, { to: event.conv, text: "source" }),
		).toMatchObject({ ok: true });
	} finally {
		await x.delivery.close();
		await x.db.close();
	}
});

test("final check prevents a beforeSend hook changing an authorized instance into B", async () => {
	const x = await setup({ id: "redirect", beforeSend: () => ({ message: { to: "conv:b:chat", text: "redirected" } }) });
	try {
		expect(await x.delivery.sendTool(x.ctx, { to: "conv:a:chat", text: "scope test" })).toMatchObject({
			ok: false,
			error: expect.stringContaining("not authorized"),
		});
		for (const counter of x.counters) expect(counter.send).not.toHaveBeenCalled();
	} finally {
		await x.delivery.close();
		await x.db.close();
	}
});

test.each([false, true])(
	"native task_run captures the invoking parent scope even after current config broadens (%s)",
	async (broadened) => {
		const x = await setup();
		try {
			// A background invocation retains its run snapshot when the session moves to a later run.
			if (broadened) x.config.resolved.channelInstances = ["a", "b"];
			const result = await x.tools
				.find((t) => t.name === "task_run")!
				.execute({ preset: "child", task: "Scope initialization" }, x.ctx);
			expect(result).toMatchObject({ isError: true, text: expect.stringContaining("no model started") });
			expect(x.saved.get("2")).toMatchObject({ agent: null, profile: "child", channelInstances: [] });
		} finally {
			await x.delivery.close();
			await x.db.close();
		}
	},
);

test.each(["scope", "program-message"])(
	"retry rechecks %s revocation and records a terminal denial without platform dispatch",
	async (kind) => {
		const x = await setup();
		try {
			x.counters[0]!.send.mockResolvedValueOnce({ ok: false, retryable: true, error: "Unsent protocol failure" });
			const request = { to: "conv:a:chat", text: "retry scope regression" };
			const result =
				kind === "scope"
					? await x.delivery.sendTool(x.ctx, request)
					: await x.delivery.sendOwned("scope-probe", request, x.config, x.session);
			expect(result).toMatchObject({ ok: false, retryable: true });
			if (kind === "scope") x.config.resolved.channelInstances = [];
			else x.config.resolved.capabilities = ["read"];
			await expect.poll(async () => (await x.store.events.retryableAttempts()).length, { timeout: 4000 }).toBe(0);
			expect(x.counters[0]!.send).toHaveBeenCalledTimes(1);
			expect(x.counters[1]!.send).not.toHaveBeenCalled();
			const denied = (await x.store.events.query({ type: "message.out" })).events.at(-1)!;
			expect(denied.data).toMatchObject({
				delivery: { ok: false, error: expect.stringMatching(/not authorized|message capability/) },
			});
		} finally {
			await x.delivery.close();
			await x.db.close();
		}
	},
);
