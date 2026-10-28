import { mkdtemp, readFile, rm } from "node:fs/promises";
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
import { Type } from "typebox";
import { expect, test, vi } from "vitest";
import { resolveProfile } from "../config/test-support.js";
import { openDatabase } from "./db.js";
import { Runtime } from "./index.js";

test("SDK context cache and automatic cache run through the native background wrapper", async () => {
	const home = await mkdtemp("/tmp/yonder-cache-runtime-");
	let runtime: Runtime | undefined;
	try {
		const full = `${"line\n".repeat(2100)}last line`;
		let explicit = "";
		runtime = await Runtime.open({
			home,
			db: await openDatabase(join(home, "state.db")),
			config: { schema: 1 },
			resolveSession: async () => ({
				agent: null,
				profile: "default",
				cwd: home,
				resolved: resolveProfile({ level: "bypass" }),
			}),
			tools: [
				{
					name: "cache_probe",
					description: "cache check",
					parameters: Type.Object({}),
					capabilities: [],
					async execute(_args, ctx) {
						if (!ctx.cacheToolOutput) throw new Error("cache API missing");
						explicit = await ctx.cacheToolOutput(full, { extension: "json" });
						return { text: full };
					},
				},
			],
		});
		const internal = runtime as unknown as {
			harness: Harness;
			tools: Map<string, ToolRegistration>;
			backgroundTool(tool: ToolRegistration): ToolRegistration;
			registry: { install(extension: ReturnType<typeof defineExtension>): void };
		};
		internal.tools.set(
			"stream_probe",
			internal.backgroundTool({
				name: "stream_probe",
				description: "stream check",
				parameters: Type.Object({}),
				async execute(_args, api) {
					api.output(full.repeat(8));
					return {};
				},
			}),
		);
		const driver = defineTask<JsonObject, { phase: "run" }, ToolExecutionResult>({
			name: "cache-check",
			version: 1,
			initial: () => ({ phase: "run" }),
			phases: {
				async run(job, task, context) {
					const api = {
						conversationId: job.conversationId,
						taskId: job.id,
						callId: `check-${job.id}`,
						async commit(change, ctx) {
							let result: unknown;
							await task.commit(async (tx) => {
								result = await change(tx);
								return undefined;
							}, ctx);
							return result;
						},
						async createTask(child, input, options, ctx) {
							let id: TaskId | undefined;
							await task.commit(async (tx) => {
								id = await tx.createTask(child, input, { ...options, conversationId: job.conversationId });
								return undefined;
							}, ctx);
							if (id === undefined) throw new Error("task missing");
							return id;
						},
					} as ToolExecutionApi;
					const tool = internal.tools.get(String(job.input.tool ?? "cache_probe"));
					if (!tool) throw new Error("cache tool missing");
					const result = await tool.execute({}, api, context);
					await task.commit(() => ({ status: "terminal", outcome: { status: "completed", result } }), context);
				},
			},
			async abort(_job, task, context) {
				await task.commit(
					() => ({ status: "terminal", outcome: { status: "completed", result: { isError: true } } }),
					context,
				);
			},
		});
		internal.registry.install(defineExtension({ name: "cache-check", tasks: [driver] }));
		const session = await runtime.create({ agent: null, profile: "default", cwd: home });
		await runtime.configure(session);
		const id = await internal.harness.commit(
			(tx) =>
				tx.createTask(
					driver,
					{},
					{ conversationId: Number(session) as never, ownership: { kind: "conversation" }, background: true },
				),
			C,
		);
		const result = await internal.harness.waitForTask(id, C);
		if (result.state.outcome.status !== "completed") throw new Error(JSON.stringify(result.state.outcome));
		const text = result.state.outcome.result.output?.find((part) => part.type === "text")?.text ?? "";
		const automatic = text.match(/Full output: (.+?)\. Use read/)?.[1];
		expect(automatic).toBeTruthy();
		if (!automatic) throw new Error("automatic cache path missing");
		expect(await readFile(explicit, "utf8")).toBe(full);
		expect(await readFile(automatic, "utf8")).toBe(full);
		expect(explicit.endsWith(".json")).toBe(true);
		const streamId = await internal.harness.commit(
			(tx) =>
				tx.createTask(
					driver,
					{ tool: "stream_probe" },
					{ conversationId: Number(session) as never, ownership: { kind: "conversation" }, background: true },
				),
			C,
		);
		const streamed = await internal.harness.waitForTask(streamId, C);
		if (streamed.state.outcome.status !== "completed") throw new Error("stream failed");
		const hint = streamed.state.outcome.result.output?.find((part) => part.type === "text")?.text ?? "";
		const streamPath = hint.match(/Full output: (.+?)\. Use read/)?.[1];
		if (!streamPath) throw new Error(`stream cache path missing: ${hint.slice(0, 200)}`);
		expect(await readFile(streamPath, "utf8")).toBe(full.repeat(8));
		vi.stubEnv("TMPDIR", join(home, "missing"));
		const failedCaptureId = await internal.harness.commit(
			(tx) =>
				tx.createTask(
					driver,
					{ tool: "stream_probe" },
					{ conversationId: Number(session) as never, ownership: { kind: "conversation" }, background: true },
				),
			C,
		);
		const failedCapture = await internal.harness.waitForTask(failedCaptureId, C);
		if (failedCapture.state.outcome.status !== "completed") throw new Error("capture failure interrupted tool");
		expect(failedCapture.state.outcome.result.isError).not.toBe(true);
		expect(failedCapture.state.outcome.result.output?.[0]).toMatchObject({
			text: "Output cache failed; full output is unavailable.",
		});
	} finally {
		vi.unstubAllEnvs();
		await runtime?.close();
		await rm(home, { recursive: true, force: true });
	}
});
