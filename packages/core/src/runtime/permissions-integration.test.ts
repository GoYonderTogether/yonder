import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT as C } from "@earendil-works/chord/context";
import {
	defineExtension,
	defineTask,
	type Harness,
	type JsonObject,
	type TaskId,
	type ToolExecutionApi,
	type ToolExecutionResult,
	type ToolRegistration,
} from "@earendil-works/pi-durable";
import type { PermissionProvider, PermissionRequest, ToolContext, YEvent } from "@yonder/sdk";
import { expect, test } from "vitest";
import { resolveProfile } from "../config/index.js";
import { createPermissions } from "../permissions.js";
import { newEvent } from "../store/index.js";
import { createPermissionsTool } from "../tools/permissions.js";
import { openDatabase } from "./db.js";
import { Runtime } from "./index.js";
import type { RuntimeSessionConfig } from "./types.js";

function required<T>(value: T | undefined): T {
	if (value === undefined) throw new Error("Missing contract fixture value");
	return value;
}

const request = { provider: "permission-contract.os", action: "status", kind: "contract-kind" } as const;
const raw = { platform: "contract-test-only", result: { state: "requested" } };
const text = (result: ToolExecutionResult) =>
	result.output?.map((part) => (part.type === "text" ? part.text : "")).join("") ?? "";

// This is a runtime/registry contract, not a model, kernel bootstrap or OS E2E.
// The native driver chooses arguments instead of invoking a model. Like background.test.ts,
// it supplies the ToolExecutionApi commit fixture and input snapshot, but executes the real
// registered tool, background task and Runtime.adapter. It never writes toolInvocations.
async function fixture(invoke: PermissionProvider["invoke"] = async () => raw) {
	const home = await mkdtemp(join(tmpdir(), "yonder-permission-integration-"));
	let runtime: Runtime | undefined;
	try {
		const boundary: ToolContext[] = [];
		const selected: ToolContext[] = [];
		const delivered: Array<{ request: PermissionRequest; ctx: ToolContext }> = [];
		const permissions = createPermissions(async (ctx) => {
			required(runtime).assertToolContext(ctx);
			selected.push(ctx);
			const config = await required(runtime).sessionConfig(ctx.session);
			expect(ctx.agent).toBe(config.agent);
			expect(ctx.profile).toBe(config.profile);
			return config.resolved.plugins;
		});
		// An explicitly labelled in-process provider fixture: no native permission driver.
		const provider: PermissionProvider = {
			id: request.provider,
			scope: "runtime contract fixture only",
			kinds: [request.kind],
			async invoke(input, ctx) {
				expect(ctx.signal.aborted).toBe(false);
				delivered.push({ request: input, ctx });
				return invoke(input, ctx);
			},
		};
		permissions.register(provider);
		permissions.register({ ...provider, id: "disabled-contract.os" });
		const tool = createPermissionsTool(permissions);
		runtime = await Runtime.open({
			home,
			db: await openDatabase(`${home}/state.db`),
			config: { schema: 1 },
			plugins: [{ id: "permission-contract", tools: [], hooks: [] }],
			resolveSession: async (id) => {
				const meta = await required(runtime).sessionState(id);
				if (!meta) throw new Error(`Missing stored runtime session ${id}`);
				return {
					agent: null,
					profile: meta.profile,
					cwd: home,
					resolved: resolveProfile({
						capabilities: ["read", "exec"],
						plugins: meta.profile === "enabled" ? ["permission-contract"] : [],
					}),
				};
			},
			tools: [
				{
					...tool,
					// Capture, without rebuilding, the SDK context created by the actual adapter.
					async execute(args, ctx) {
						boundary.push(ctx);
						required(runtime).assertToolContext(ctx);
						return tool.execute(args, ctx);
					},
				},
			],
		});
		const internal = runtime as unknown as {
			harness: Harness;
			tools: Map<string, ToolRegistration>;
			invocationConfigs: WeakMap<object, { config: RuntimeSessionConfig; events: YEvent[] }>;
			registry: { install(extension: ReturnType<typeof defineExtension>): void };
		};
		const event = newEvent({ type: "message.in", from: "acct:contract:owner", data: { text: "permission contract" } });
		const driver = defineTask<{ args: JsonObject }, { phase: "run" }, ToolExecutionResult>({
			name: "yonder.permission-contract",
			version: 1,
			initial: () => ({ phase: "run" }),
			phases: {
				async run(job, task, context) {
					const api = {
						conversationId: job.conversationId,
						taskId: job.id,
						callId: `contract-${job.id}`,
						async commit(change, ctx) {
							let result: unknown;
							await task.commit(async (tx) => {
								result = await change(tx);
								return undefined;
							}, ctx);
							return result;
						},
					} as ToolExecutionApi;
					const registration = internal.tools.get("permissions");
					if (!registration) throw new Error("Missing actual permissions registration");
					internal.invocationConfigs.set(context, {
						config: await required(runtime).sessionConfig(String(job.conversationId)),
						events: [event],
					});
					let result: ToolExecutionResult;
					try {
						result = await registration.execute(job.input.args, api, context);
					} finally {
						internal.invocationConfigs.delete(context);
					}
					await task.commit(() => ({ status: "terminal", outcome: { status: "completed", result } }), context);
				},
			},
			async abort(_job, task, context) {
				await task.commit(() => ({ status: "terminal", outcome: { status: "aborted" } }), context);
			},
		});
		internal.registry.install(defineExtension({ name: "yonder.permission-contract", tasks: [driver] }));
		const enabled = await runtime.create({ agent: null, profile: "enabled", cwd: home });
		const disabled = await runtime.create({ agent: null, profile: "disabled", cwd: home });
		await runtime.configure(enabled);
		await runtime.configure(disabled);
		const start = (args: JsonObject, session = enabled) =>
			internal.harness.commit(
				(tx) =>
					tx.createTask(
						driver,
						{ args },
						{
							conversationId: Number(session) as never,
							ownership: { kind: "conversation" },
							background: true,
						},
					),
				C,
			);
		const done = async (id: TaskId<ToolExecutionResult>) => {
			const job = await internal.harness.waitForTask(id, C);
			if (job.state.outcome.status !== "completed")
				throw new Error(`Contract driver failed: ${JSON.stringify(job.state.outcome)}`);
			return job.state.outcome.result;
		};
		return {
			runtime,
			permissions,
			boundary,
			selected,
			delivered,
			event,
			enabled,
			disabled,
			start,
			done,
			call: async (args: JsonObject, session = enabled) => done(await start(args, session)),
			async close() {
				await required(runtime).close();
				await rm(home, { recursive: true, force: true });
			},
		};
	} catch (error) {
		await runtime?.close();
		await rm(home, { recursive: true, force: true });
		throw error;
	}
}

test.each(["status", "request", "guide", "watch"] as const)(
	"real Runtime.adapter context invokes registry provider for %s, then expires",
	async (action) => {
		const f = await fixture();
		try {
			const result = await f.call({ ...request, action });
			expect(result.isError).not.toBe(true);
			expect(JSON.parse(text(result))).toEqual(raw);
			expect(f.boundary).toHaveLength(1);
			expect(f.selected).toHaveLength(1);
			expect(f.delivered).toHaveLength(1);
			const ctx = required(f.boundary[0]);
			expect(f.selected[0]).toBe(ctx);
			expect(required(f.delivered[0]).ctx).toBe(ctx);
			expect(required(f.delivered[0]).request).toEqual({ ...request, action });
			expect(ctx).toMatchObject({
				agent: null,
				profile: "enabled",
				session: f.enabled,
				capabilities: ["read", "exec"],
			});
			expect(ctx.env.id).toBe("node:local");
			expect(ctx.event).toEqual(f.event);
			expect(ctx.events).toEqual([f.event]);
			expect(ctx.events?.[0]).toBe(ctx.event);
			expect(required(f.delivered[0]).ctx.env).toBe(ctx.env);
			expect(required(f.delivered[0]).ctx.signal).toBe(ctx.signal);
			// pi also aborts its native signal when the invocation ends normally.
			expect(ctx.signal.aborted).toBe(true);
			expect(() => f.runtime.assertToolContext(ctx)).toThrow("真实运行中的工具调用上下文");
			await expect(f.permissions.invoke(request, ctx)).rejects.toBe(ctx.signal.reason);
			await expect(f.permissions.list(ctx)).rejects.toBe(ctx.signal.reason);
			expect(f.delivered).toHaveLength(1);
		} finally {
			await f.close();
		}
	},
);

test("real adapter rejects unselected provider and disabled profile, including list", async () => {
	const f = await fixture();
	try {
		const unselected = await f.call({ ...request, provider: "disabled-contract.os" });
		expect(unselected.isError).toBe(true);
		expect(text(unselected)).toContain("not enabled");
		const disabled = await f.call(request, f.disabled);
		expect(disabled.isError).toBe(true);
		expect(text(disabled)).toContain("not enabled");
		expect(JSON.parse(text(await f.call({ action: "list" }, f.disabled)))).toEqual([]);
		expect(f.boundary.map((ctx) => ctx.profile)).toEqual(["enabled", "disabled", "disabled"]);
		expect(f.delivered).toHaveLength(0);
		for (const ctx of f.boundary) expect(() => f.runtime.assertToolContext(ctx)).toThrow("真实运行中的工具调用上下文");
	} finally {
		await f.close();
	}
});

test("provider failure still expires the actual adapter context", async () => {
	const f = await fixture(async () => {
		throw new Error("contract provider failed");
	});
	try {
		const result = await f.call(request);
		expect(result.isError).toBe(true);
		expect(text(result)).toContain("contract provider failed");
		expect(f.delivered).toHaveLength(1);
		const ctx = required(f.boundary[0]);
		expect(() => f.runtime.assertToolContext(ctx)).toThrow("真实运行中的工具调用上下文");
		await expect(f.permissions.invoke(request, ctx)).rejects.toBe(ctx.signal.reason);
		expect(f.delivered).toHaveLength(1);
	} finally {
		await f.close();
	}
});

test("runtime abort reaches the provider's original SDK signal and releases the context", async () => {
	let entered!: (ctx: ToolContext) => void;
	const ready = new Promise<ToolContext>((resolve) => {
		entered = resolve;
	});
	let observed: unknown;
	let exited = false;
	const f = await fixture(async (_request, ctx) => {
		entered(ctx);
		try {
			return await new Promise<never>((_resolve, reject) => {
				ctx.signal.addEventListener(
					"abort",
					() => {
						observed = ctx.signal.reason;
						reject(observed);
					},
					{ once: true },
				);
			});
		} finally {
			exited = true;
		}
	});
	try {
		const id = await f.start({ ...request, action: "watch" });
		// Keep a real harness waiter active while the provider is suspended.
		const completed = f.done(id).then(
			(result) => ({ result, error: undefined }),
			(error: unknown) => ({ result: undefined, error }),
		);
		await expect.poll(() => f.delivered.length).toBe(1);
		const ctx = await ready;
		expect(ctx).toBe(f.boundary[0]);
		expect(ctx.signal).toBe(required(f.selected[0]).signal);
		expect(() => f.runtime.assertToolContext(ctx)).not.toThrow();
		await f.runtime.abort(f.enabled);
		await expect.poll(() => exited).toBe(true);
		expect(ctx.signal.aborted).toBe(true);
		expect(observed).toBe(ctx.signal.reason);
		expect(observed).toBeDefined();
		expect(() => f.runtime.assertToolContext(ctx)).toThrow("真实运行中的工具调用上下文");
		await expect(f.permissions.invoke(request, ctx)).rejects.toBe(ctx.signal.reason);
		expect((await completed).error).toBeInstanceOf(Error);
		expect(f.delivered).toHaveLength(1);
	} finally {
		await f.close();
	}
});
