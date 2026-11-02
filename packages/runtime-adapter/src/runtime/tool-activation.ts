import type { Context } from "@earendil-works/chord";
import type { ToolExecutionApi } from "@earendil-works/pi-durable";
import {
	defineExtension,
	defineTool,
	type Extension,
	GenerationTask,
	hook,
	type JsonObject,
	type ToolRegistration,
	ToolTask,
} from "@earendil-works/pi-durable";
import { getOrThrow } from "@earendil-works/pi-durable/env";
import { createToolSearchExtension } from "@earendil-works/pi-durable/tool-search";
import { createCodingTools, type ReadToolInput } from "@earendil-works/pi-durable/tools";
import type { Attachment, Hook, Tool, ToolContext } from "@yonder/sdk";
import { Type } from "typebox";
import type { RuntimeBackground, RuntimeLiveOutput } from "../contracts.js";
import type { Input as BackgroundInput } from "./background-docs.js";
import type { RemoteFind } from "./find.js";
import { createFindTool } from "./find.js";
import type { RemoteGrep } from "./grep.js";
import { createGrepTool } from "./grep.js";
import { allowedHostTool, refreshHostTools } from "./host-tools.js";
import { imageHistoryHooks } from "./image-history.js";
import type { RuntimeInternals } from "./instance.js";
import { createLsTool } from "./ls.js";
import { programSnapshot } from "./program.js";
import { promptSections } from "./prompt-sections.js";
import { recoveryHooks, retryPolicy } from "./recovery.js";
import { fromResult, toResult } from "./results.js";
import { systemAsUserHooks } from "./system-as-user.js";
import { todoTool } from "./todo-tool.js";
import { normalizeToolImages, prepareWith } from "./tool-images.js";

export interface RuntimeToolHost {
	cacheTools?: boolean;
	cacheOutput?(config: string): boolean;
	createBackground(options: RuntimeBackgroundOptions): RuntimeBackground;
	processTool(
		home: string,
		running: Map<number, RuntimeLiveOutput>,
		config: (id: string) => Promise<import("./types.js").RuntimeSessionConfig>,
	): ToolRegistration;
	cacheSdkResult(
		result: import("@earendil-works/pi-durable").ToolExecutionResult,
		context: ToolContext,
		input: { name: string; args: object },
		options: { home: string; onReport?: (error: unknown) => void },
	): Promise<import("@earendil-works/pi-durable").ToolExecutionResult>;
	toolOutputWriter(
		context: ToolContext,
		tool: string,
		args: object,
		home: string,
	): (text: string | AsyncIterable<Uint8Array>, options?: { extension?: string }) => Promise<string>;
	fileURLToPath(uri: string): string;
	readCachedOutput?(
		path: string,
		offset?: number | string,
		limit?: number,
	): Promise<import("@earendil-works/pi-durable").ToolExecutionResult | undefined>;
	grepCachedOutput?(input: {
		path?: string;
		pattern: string;
		literal?: boolean;
		ignoreCase?: boolean;
		context?: number;
		limit?: number;
	}): Promise<{ text: string } | undefined>;
	remoteFind: RemoteFind;
	remoteGrep: RemoteGrep;
}

export interface RuntimeBackgroundOptions {
	home?: string;
	cacheOutput?(config: string): boolean;
	harness(): RuntimeInternals["harness"];
	config(session: string, context: import("@earendil-works/chord").Context): Promise<string>;
	execute(
		input: BackgroundInput,
		api: import("@earendil-works/pi-durable").ToolExecutionApi,
		context: import("@earendil-works/chord").Context,
	): Promise<import("@earendil-works/pi-durable").ToolExecutionResult>;
	finished(
		session: string,
		id: string,
		name: string,
		result: import("@earendil-works/pi-durable").ToolExecutionResult,
		origin?: import("@yonder/sdk").YEvent,
	): Promise<void>;
	report(error: unknown): void;
	changed?(session: string): void;
	settled?(session: string): Promise<void>;
}

export function installExtensions(rt: RuntimeInternals, host: RuntimeToolHost) {
	rt.background = host.createBackground({
		home: rt.options.home,
		cacheOutput: (snapshot) =>
			host.cacheOutput?.(snapshot) ?? rt.environment(JSON.parse(snapshot).config).id === "node:local",
		harness: () => rt.harness,
		changed: (session) => rt.options.onBackgroundChanged?.(session),
		config: async (session, context) => {
			const ctx = await rt.context(session, context);
			const invocation = rt.invocationConfigs.get(context);
			const runId = invocation?.runId ?? ctx.runId;
			return JSON.stringify({
				config: invocation?.config ?? rt.currentConfig(session) ?? (await rt.options.resolveSession(session)),
				events: invocation?.events ?? ctx.events ?? [],
				...(runId ? { runId } : {}),
			});
		},
		execute: async (input, api, context) => {
			const snapshot = JSON.parse(input.config);
			rt.invocationConfigs.set(context, {
				...snapshot,
				operationPrefix: `${api.conversationId}:${api.taskId}`,
				operationSequence: 0,
			});
			try {
				const tool = rt.rawTools.get(input.name);
				if (!tool) throw new Error(`Unavailable tool: ${input.name}`);
				let result: ReturnType<typeof toResult>;
				try {
					result = await tool.execute(input.args, { ...api, env: rt.environment(snapshot.config) }, context);
				} catch (error) {
					result = toResult({ text: error instanceof Error ? error.message : String(error), isError: true });
				}
				const ctx = await rt.context(String(api.conversationId), context);
				for (const plugin of rt.options.plugins ?? [])
					if (snapshot.config.resolved.plugins.includes(plugin.id))
						for (const hook of plugin.hooks) {
							const changed = await hook.afterTool?.(
								{ id: api.callId, name: input.name, args: input.args },
								fromResult(result),
								ctx,
							);
							if (changed) result = toResult(changed.result);
						}
				// 插件工具可以塞任意大小的图片；统一按工具图片上限重新编码，避免大块 base64 进入转录和历史请求。
				if ((result.output ?? []).some((block) => block.type === "image"))
					result = await normalizeToolImages(
						result,
						prepareWith(() => rt.imageProcessor()),
					);
				if (rt.sdkToolNames.has(input.name) && (host.cacheTools || ctx.env.id === "node:local"))
					result = await host.cacheSdkResult(result, ctx, input, rt.options);
				return result;
			} finally {
				rt.invocationConfigs.delete(context);
			}
		},
		finished: async (session, id, name, value, origin) => {
			const outputFile = (value.details as { fullOutputPath?: unknown } | undefined)?.fullOutputPath;
			await rt.options.onBackground?.(session, {
				id,
				name,
				result: fromResult(value),
				...(origin ? { origin } : {}),
				...(typeof outputFile === "string" ? { outputFile } : {}),
			});
		},
		report: (error) => rt.options.onReport?.(error),
		settled: (session) => rt.idleChanged(session),
	});
	rt.registry.install(rt.background.extension);
	rt.extensions.set(rt.background.extension.name, rt.background.extension);

	const core = defineExtension({
		name: "yonder.core",
		sections: promptSections(
			rt.options,
			(id) => rt.currentConfig(id),
			(name) => rt.toolGuidelines.get(name),
		),
		hooks: [
			hook(ToolTask, {
				beforeTool: async (_call, api, context) => {
					const snapshot = await programSnapshot(rt, api.taskId, context);
					if (snapshot)
						rt.invocationConfigs.set(context, {
							...snapshot,
							operationPrefix: `program:${api.conversationId}:${api.taskId}`,
							operationSequence: 0,
						});
				},
			}),
			hook(GenerationTask, {
				beforeRequest: async (_request, api, context) => {
					const config = rt.currentConfig(String(api.conversationId));
					if (!config?.hostTools) return;
					const frozen = config.hostTools.map((entry) => entry.name);
					await refreshHostTools(rt, config, context.abortSignal);
					const removed = frozen.filter((name) => !allowedHostTool(rt, config, name));
					if (!removed.length) return;
					return { toolsRemoved: removed };
				},
			}),
			// 图片裁剪必须在 limits 的图片数量检查之前：旧图先变成文字，检查才不会被历史图片挡住。
			...imageHistoryHooks(),
			...rt.limits.hooks(),
			...recoveryHooks(() => rt.harness, retryPolicy(rt.options.config.retry).maxRetries),
			...systemAsUserHooks(() => rt.harness),
		],
	});
	rt.registry.install(core);
	rt.extensions.set(core.name, core);
	const codingTools = createCodingTools({
		images: { prepare: async (...args) => (await rt.imageProcessor()).prepare(...args) },
	});
	const codingRegistrations = (codingTools.tools ?? []).map((tool) => {
		const readCachedOutput = host.readCachedOutput;
		if (tool.name !== "read" || !readCachedOutput) return tool;
		return {
			...tool,
			async execute(args: ReadToolInput, api: ToolExecutionApi, context: Context) {
				const input = args;
				const page = await readCachedOutput(input.path, input.offset, input.limit);
				return page ?? tool.execute(args, api, context);
			},
		};
	});
	const coding = defineExtension({
		...codingTools,
		name: "yonder.files",
		tools: [
			...codingRegistrations.filter((t) => t.name !== "bash"),
			host.processTool(rt.options.home, rt.background.running, (id) => rt.sessionConfig(id)),
		].map((t) => rt.backgroundTool({ ...t, deferred: true })),
	});
	rt.registry.install(coding);
	rt.extensions.set(coding.name, coding);
	const search = createToolSearchExtension();
	rt.registry.install(search);
	rt.extensions.set(search.name, search);
	for (const extension of [coding, search]) for (const tool of extension.tools ?? []) rt.tools.set(tool.name, tool);
	const todo = todoTool((session) => rt.outbox.deliver(session));
	const todos = defineExtension({ name: "yonder.todo", tools: [todo] });
	rt.capabilities.set("todo", []);
	rt.registry.install(todos);
	rt.extensions.set(todos.name, todos);
	rt.tools.set("todo", todo);
	const processes = defineExtension({
		name: "yonder.process",
		tools: [...rt.background.tools, rt.background.tool],
	});
	for (const tool of processes.tools ?? []) {
		rt.capabilities.set(tool.name, []);
		rt.tools.set(tool.name, tool);
	}
	rt.registry.install(processes);
	rt.extensions.set(processes.name, processes);
	const builtins = rt.adapter(
		"yonder.tools",
		[createGrepTool(host.remoteGrep), createFindTool(host.remoteFind), createLsTool(), ...(rt.options.tools ?? [])],
		[],
	);
	rt.registry.install(builtins);
	rt.extensions.set(builtins.name, builtins);
	for (const plugin of rt.options.plugins ?? []) {
		const extension = rt.adapter(`plugin:${plugin.id}`, plugin.tools, plugin.hooks);
		rt.registry.install(extension);
		rt.extensions.set(extension.name, extension);
	}
}
export function backgroundTool(rt: RuntimeInternals, tool: ToolRegistration): ToolRegistration {
	rt.rawTools.set(tool.name, tool);
	const registration = {
		...tool,
		...(tool.structuredOutputSchema
			? {
					structuredOutputSchema: Type.Union([tool.structuredOutputSchema, Type.Object({ background: Type.String() })]),
				}
			: {}),
	};
	return {
		...registration,
		execute: (args, api, context) =>
			// Program roots and their nested ToolTasks already have durable execution and output handling.
			rt.invocationConfigs.get(context)?.allowedTools !== undefined
				? tool.execute(args, api, context)
				: rt.background.run(tool, args as JsonObject, api, context),
	};
}
export function adapter(
	rt: RuntimeInternals,
	host: RuntimeToolHost,
	name: string,
	tools: Tool[],
	hooks: Hook[],
): Extension {
	const registrations = tools.map((tool) => {
		rt.sdkToolNames.add(tool.name);
		if (tool.guidelines) rt.toolGuidelines.set(tool.name, tool.guidelines);
		rt.capabilities.set(tool.name, tool.capabilities);
		const registration = rt.backgroundTool(
			defineTool({
				name: tool.name,
				description: tool.description,
				parameters: tool.parameters,
				deferred: true,
				...(["task_run", "agent_ask", "parent_ask", "task_continue"].includes(tool.name)
					? { replay: "safe" as const }
					: {}),
				execute: async (args, api, context) => {
					const ctx = await rt.context(String(api.conversationId), context);
					if (host.cacheTools || ctx.env.id === "node:local") {
						const writer = host.toolOutputWriter(ctx, tool.name, args as object, rt.options.home);
						ctx.cacheToolOutput = writer;
						ctx.cacheToolOutputStream = writer;
					}
					ctx.authorizeFileWrite = async (path) => {
						rt.assertToolContext(ctx);
						const config = rt.invocationConfigs.get(context)?.config ?? rt.currentConfig(ctx.session);
						if (!config) throw new Error("当前运行配置不存在。");
						if (!config.resolved.capabilities.includes("write")) throw new Error("缺少能力：write");
						const denied = await rt.policy.denied("write", { path }, config, context, ctx.session);
						if (denied) throw new Error(denied);
					};
					rt.toolInvocations.set(ctx, { api, context });
					try {
						if (tool.name === "grep" && host.grepCachedOutput) {
							const cached = await host.grepCachedOutput(
								args as Parameters<NonNullable<typeof host.grepCachedOutput>>[0],
							);
							if (cached) return toResult(cached);
						}
						return toResult(await tool.execute(args, ctx));
					} finally {
						rt.toolInvocations.delete(ctx);
					}
				},
			}),
		);
		rt.tools.set(tool.name, registration);
		return registration;
	});
	return defineExtension({
		name,
		tools: registrations,
		hooks: hooks.flatMap((plugin) => [
			hook(ToolTask, {
				afterTool: async (call, result, api, context) => {
					// Process management is native, not a background-wrapped SDK tool.
					if (call.name !== "process") return;
					const changed = await plugin.afterTool?.(
						{ id: call.id, name: call.name, args: call.arguments },
						fromResult(result),
						await rt.context(String(api.conversationId), context),
					);
					return changed ? toResult(changed.result) : undefined;
				},
				beforeTool: async (call, api, context) => {
					const result = await plugin.beforeTool?.(
						{ id: call.id, name: call.name, args: call.arguments },
						await rt.context(String(api.conversationId), context),
					);
					return result
						? "block" in result
							? { block: result.block }
							: { arguments: result.args as JsonObject }
						: undefined;
				},
			}),
			hook(GenerationTask, {
				beforeRequest: async (request, api, context) =>
					plugin.beforeRequest?.([...request.messages], await rt.context(String(api.conversationId), context)),
			}),
		]),
	});
}
/** Shared services may only act with the exact context of an active native tool invocation. */
export function assertToolContext(rt: RuntimeInternals, ctx: ToolContext): void {
	if (!rt.toolInvocations.has(ctx)) throw new Error("需要真实运行中的工具调用上下文。");
	ctx.signal.throwIfAborted();
}
export async function authorizeAttachments(
	rt: RuntimeInternals,
	host: RuntimeToolHost,
	ctx: ToolContext,
	attachments: Attachment[] = [],
): Promise<void> {
	const invocation = rt.toolInvocations.get(ctx);
	if (!invocation) throw new Error("需要真实运行中的工具调用上下文。");
	ctx.signal.throwIfAborted();
	if (!attachments.length) return;
	const config = rt.currentConfig(ctx.session);
	if (!config) throw new Error("当前运行配置不存在。");
	if (ctx.env.id !== "node:local") throw new Error("渠道附件暂不支持远程执行环境。");
	for (const attachment of attachments) {
		if (!attachment.uri.startsWith("file:")) throw new Error("发送附件必须是可验证的本地文件 URI。");
		const path = host.fileURLToPath(attachment.uri);
		const denied = await rt.policy.denied("read", { path }, config, invocation.context, ctx.session);
		if (denied) throw new Error(denied);
		getOrThrow(await ctx.env.canonicalPath(path, invocation.context));
	}
}
