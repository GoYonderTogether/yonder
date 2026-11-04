import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { resolveProfile } from "@yonder/bot-definition";
import type { Tool, ToolContext } from "@yonder/sdk";
import { tempHome } from "@yonder/sdk/testing";
import { Type } from "typebox";
import { expect, test } from "vitest";
import { openNodeRuntime } from "../node/open-runtime.js";
import { openDatabase, openRuntimeStorage } from "../node/runtime/db.js";
import type { RuntimeInternals } from "./instance.js";
import { callProgramTool, programConversationId } from "./program.js";

test("program ToolTask inherits its frozen scope through real nested tool tasks", async () => {
	const home = await tempHome("yonder-program-nested-");
	const nestedCalls: string[] = [];
	const seenScopes: Array<{ value: string; cwd: string | undefined; resources?: ToolContext["resources"] }> = [];
	let runtime: Awaited<ReturnType<typeof openNodeRuntime>> | undefined;
	let internal: RuntimeInternals | undefined;
	let resolveHoldStarted: () => void = () => {};
	const holdStarted = new Promise<void>((resolve) => (resolveHoldStarted = resolve));
	let holdSignal: AbortSignal | undefined;
	try {
		const parent: Tool = {
			name: "program_parent",
			description: "Calls the child through the active ToolTask.",
			parameters: Type.Object({ child: Type.String() }),
			capabilities: [],
			async execute(args, context: ToolContext) {
				const target = internal;
				const invocation = target?.toolInvocations.get(context);
				if (!invocation) throw new Error("Missing active native tool invocation");
				const childName = (args as { child: string }).child;
				const child = await invocation.api.executeTool(
					childName,
					childName === "program_child" ? { value: "nested" } : {},
					invocation.context,
				);
				return { text: child.isError ? "blocked" : String(child.structuredOutput) };
			},
		};
		const child: Tool = {
			name: "program_child",
			description: "Returns its input.",
			parameters: Type.Object({ value: Type.String() }),
			capabilities: ["read"],
			async execute(args, context) {
				const value = String((args as { value: string }).value);
				nestedCalls.push(value);
				seenScopes.push({
					value,
					cwd: "cwd" in context.env ? String(context.env.cwd) : undefined,
					...(context.resources ? { resources: structuredClone(context.resources) } : {}),
				});
				return { text: value };
			},
		};
		const hold: Tool = {
			name: "program_hold",
			description: "Waits until its native task is aborted.",
			parameters: Type.Object({}),
			capabilities: ["read"],
			execute(_args, context) {
				holdSignal = context.signal;
				resolveHoldStarted();
				return new Promise((resolve) => {
					if (context.signal.aborted) return resolve({ text: "aborted" });
					context.signal.addEventListener("abort", () => resolve({ text: "aborted" }), { once: true });
				});
			},
		};
		const open = async () =>
			openNodeRuntime({
				home,
				storage: await openRuntimeStorage(await openDatabase(join(home, "state.db"))),
				config: { schema: 1, compaction: { enabled: false } },
				localEnvironment: true,
				plugins: [{ id: "program-test", tools: [parent, child, hold], hooks: [] }],
				resolveSession: async () => ({
					agent: "program-test",
					profile: "program-test",
					cwd: home,
					resolved: resolveProfile({
						model: "openai/gpt-6-luna",
						plugins: ["program-test"],
						capabilities: ["read"],
						tools: { offer: ["program_parent", "program_child", "program_hold"] },
					}),
				}),
			});
		runtime = await open();
		internal = runtime as unknown as RuntimeInternals;
		const session = await runtime.create({ agent: "program-test", profile: "program-test", cwd: home });
		const config = await runtime.sessionConfig(session);
		const allowed = await callProgramTool(
			internal,
			{
				scope: "native:bot:caller:program-test",
				invocation: "allowed",
				config,
				tool: parent.name,
				arguments: { child: "program_child" },
			},
			new AbortController().signal,
		);
		expect(allowed).toMatchObject({ text: "nested", isError: false });
		expect(nestedCalls).toEqual(["nested"]);
		const cwdA = join(home, "program-a");
		const cwdB = join(home, "program-b");
		await Promise.all([mkdir(cwdA), mkdir(cwdB)]);
		const configA = { ...config, cwd: cwdA, resources: [{ deviceId: "local", paths: [cwdA] }] };
		const configB = { ...config, cwd: cwdB, resources: [{ deviceId: "local", paths: [cwdB] }] };
		const target = internal;
		if (!target) throw new Error("Missing Runtime internals");
		const [scopeA, scopeB] = await Promise.all([
			callProgramTool(
				target,
				{
					scope: "native:bot:caller:a",
					invocation: "cwd-a",
					config: configA,
					tool: child.name,
					arguments: { value: "cwd-a" },
				},
				new AbortController().signal,
			),
			callProgramTool(
				target,
				{
					scope: "native:bot:caller:b",
					invocation: "cwd-b",
					config: configB,
					tool: child.name,
					arguments: { value: "cwd-b" },
				},
				new AbortController().signal,
			),
		]);
		expect(scopeA.text).toBe("cwd-a");
		expect(scopeB.text).toBe("cwd-b");
		expect(seenScopes.find(({ value }) => value === "cwd-a")).toMatchObject({
			cwd: cwdA,
			resources: [{ deviceId: "local", paths: [cwdA] }],
		});
		expect(seenScopes.find(({ value }) => value === "cwd-b")).toMatchObject({
			cwd: cwdB,
			resources: [{ deviceId: "local", paths: [cwdB] }],
		});
		const repeated = await callProgramTool(
			internal,
			{
				scope: "native:bot:caller:program-test",
				invocation: "allowed",
				config,
				tool: parent.name,
				arguments: { child: "program_child" },
			},
			new AbortController().signal,
		);
		expect(repeated).toMatchObject({ text: "nested", isError: false });
		expect(nestedCalls).toEqual(["nested", "cwd-a", "cwd-b"]);
		const conflict = await callProgramTool(
			internal,
			{
				scope: "native:bot:caller:program-test",
				invocation: "allowed",
				config,
				tool: parent.name,
				arguments: { child: "program_hold" },
			},
			new AbortController().signal,
		);
		expect(conflict.isError).toBe(true);
		expect(conflict.text).toContain("different tool or arguments");
		const firstConversation = await programConversationId(internal, "native:bot:caller:program-test", config);
		const otherConversation = await programConversationId(internal, "native:bot:other-caller:program-test", config);
		expect(otherConversation).not.toBe(firstConversation);

		const restricted = {
			...config,
			resolved: resolveProfile({
				model: "openai/gpt-6-luna",
				plugins: ["program-test"],
				capabilities: [],
				tools: { offer: ["program_parent", "program_child", "program_hold"] },
			}),
		};
		const denied = await callProgramTool(
			internal,
			{
				scope: "native:bot:caller:restricted",
				invocation: "denied",
				config: restricted,
				tool: parent.name,
				arguments: { child: "program_child" },
			},
			new AbortController().signal,
		);
		expect(denied).toMatchObject({ text: "blocked", isError: false });
		expect(nestedCalls).toEqual(["nested", "cwd-a", "cwd-b"]);

		await runtime.close();
		runtime = await open();
		internal = runtime as unknown as RuntimeInternals;
		const restored = await callProgramTool(
			internal,
			{
				scope: "native:bot:caller:program-test",
				invocation: "allowed",
				config,
				tool: parent.name,
				arguments: { child: "program_child" },
			},
			new AbortController().signal,
		);
		expect(restored).toMatchObject({ text: "nested", isError: false });
		expect(nestedCalls).toEqual(["nested", "cwd-a", "cwd-b"]);

		const controller = new AbortController();
		const cancelledCall = callProgramTool(
			internal,
			{
				scope: "native:bot:caller:program-test",
				invocation: "cancelled",
				config,
				tool: parent.name,
				arguments: { child: "program_hold" },
			},
			controller.signal,
		);
		await holdStarted;
		controller.abort();
		const cancelled = await cancelledCall;
		expect(cancelled.isError).toBe(true);
		expect(holdSignal?.aborted).toBe(true);
	} finally {
		await runtime?.close();
		await rm(home, { recursive: true, force: true });
	}
});
