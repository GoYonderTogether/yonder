import type { SessionModels, ToolContext } from "@yonder/sdk";
import { Check } from "typebox/value";
import { expect, test } from "vitest";
import { resolveProfile, testModel } from "../config/test-support.js";
import type { DeliveryService } from "../delivery/index.js";
import { openDatabase } from "../runtime/db.js";
import type { Runtime, RuntimeInput, RuntimeSessionState } from "../runtime/index.js";
import type { Sessions } from "../sessions/index.js";
import { createStore } from "../store/index.js";
import { createCoreTools } from "./index.js";

// Configuration/input protocol driver only: real event/session store, no model response or credentials.
async function setup() {
	const db = await openDatabase(":memory:");
	const store = await createStore(db);
	await store.sessions.put({
		id: "1",
		agent: "main",
		profile: "owner",
		mode: "main",
		key: "main",
		version: "check",
		opened: new Date().toISOString(),
	});
	const parent = {
		agent: "main",
		profile: "owner",
		cwd: "/tmp",
		resolved: resolveProfile({ level: "bypass", credentialSlots: { openai: "parent", anthropic: "parent" } }),
	};
	const saved = new Map<string, RuntimeSessionState>();
	const inputs: RuntimeInput[] = [];
	let child = "2";
	const runtime = {
		sessionConfig: async () => parent,
		authorizeAttachments: async () => {},
		sessionState: async (id: string) => saved.get(id),
		setSessionState: async (id: string, state: RuntimeSessionState) => {
			saved.set(id, structuredClone(state));
		},
		runTask: async (_ctx: ToolContext, initialize: (id: string) => Promise<RuntimeInput>) => {
			inputs.push(await initialize(child));
			throw new Error("Input captured; no model started");
		},
	} as unknown as Runtime;
	const tools = createCoreTools({
		store,
		agents: new Map(),
		sessions: { version: "check" } as Sessions,
		runtime: () => runtime,
		delivery: {} as DeliveryService,
		ask: async () => {
			throw new Error("No model in protocol tests");
		},
		defaultModel: testModel,
		getPreset: () => ({ id: "slots", description: "Slot input protocol", credentialSlots: { openai: "preset" } }),
	});
	const tool = tools.find((t) => t.name === "task_run");
	if (!tool) throw new Error("Missing task_run tool");
	const ctx = {
		agent: "main",
		profile: "owner",
		session: "1",
		capabilities: parent.resolved.capabilities,
		signal: new AbortController().signal,
	} as ToolContext;
	return {
		db,
		store,
		saved,
		inputs,
		tool,
		ctx,
		next: () => {
			child = String(Number(child) + 1);
		},
	};
}

test("task_run schema uses the same provider map as SessionModels", async () => {
	const x = await setup();
	try {
		for (const credentialSlots of [{}, { openai: "work" }, { openai: "default", anthropic: "personal" }])
			expect(Check(x.tool.parameters, { preset: "slots", task: "Check selection", credentialSlots })).toBe(true);
		for (const credentialSlots of [null, "work", ["work"], { openai: "" }, { "": "work" }, { openai: 1 }])
			expect(Check(x.tool.parameters, { preset: "slots", task: "Check selection", credentialSlots })).toBe(false);
	} finally {
		await x.db.close();
	}
});

test("task_run persists structured effort + slots and replay reuses the original event, not changed arguments", async () => {
	const x = await setup();
	try {
		const credentialSlots: SessionModels["credentialSlots"] = { openai: "work", google: "default" };
		const request = { preset: "slots", task: "Check selection", effort: "low", credentialSlots };
		expect(await x.tool.execute(request, x.ctx)).toMatchObject({
			isError: true,
			text: "Input captured; no model started",
		});
		const first = x.inputs[0]?.event;
		if (!first) throw new Error("Missing structured child input");
		expect(first.data).toMatchObject({ taskOwned: true, effort: "low", credentialSlots });
		expect(x.saved.get("2")?.inherit).not.toHaveProperty("credentialSlots");
		expect(x.saved.get("2")).not.toHaveProperty("models");
		await x.tool.execute({ ...request, effort: "high", credentialSlots: { openai: "changed" } }, x.ctx);
		expect(x.inputs[1]?.event).toEqual(first);
		expect((await x.store.events.query({ type: "session.input" })).events).toHaveLength(1);
		x.next();
		await x.tool.execute({ preset: "slots", task: "No override" }, x.ctx);
		const plain = x.inputs[2]?.event;
		if (!plain) throw new Error("Missing plain child input");
		expect(plain.data).not.toHaveProperty("credentialSlots");
		expect(plain.data).not.toHaveProperty("effort");
	} finally {
		await x.db.close();
	}
});

test("per-run slots share effort's admin gate, including explicit empty maps, while plain delegation is allowed", async () => {
	const x = await setup();
	try {
		const ctx = { ...x.ctx, capabilities: ["read"] as ToolContext["capabilities"] };
		for (const override of [{ credentialSlots: {} }, { credentialSlots: { openai: "default" } }, { effort: "low" }])
			expect(await x.tool.execute({ preset: "slots", task: "Check gate", ...override }, ctx)).toMatchObject({
				isError: true,
				text: expect.stringContaining("admin"),
			});
		expect(x.inputs).toHaveLength(0);
		expect((await x.store.events.query({ type: "session.input" })).events).toHaveLength(0);
		expect(await x.tool.execute({ preset: "slots", task: "Plain delegation" }, ctx)).toMatchObject({
			text: "Input captured; no model started",
		});
		expect(x.inputs).toHaveLength(1);
	} finally {
		await x.db.close();
	}
});
