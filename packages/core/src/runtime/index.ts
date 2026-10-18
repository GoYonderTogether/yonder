import { once } from "node:events";
import { dirname, isAbsolute, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import type { Context } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT as C, withAbortSignal } from "@earendil-works/chord/context";
import {
	AgentDoc,
	type AgentEvent,
	type ConversationId,
	createRegistry,
	defineDoc,
	defineDocFamily,
	defineExtension,
	defineTool,
	type Extension,
	GenerationTask,
	Harness,
	type HookApi,
	hook,
	InboxDoc,
	type JsonObject,
	LiveDoc,
	RunReceiptDoc,
	type RunReceiptState,
	type Submission,
	section,
	type ToolExecutionApi,
	type ToolExecutionResult,
	type ToolRegistration,
	ToolTask,
	UsageDoc,
	type UsageState,
	watchEvents,
} from "@earendil-works/pi-durable";
import { getOrThrow } from "@earendil-works/pi-durable/env";
import { SqliteStorage } from "@earendil-works/pi-durable/storage/sqlite";
import { createToolSearchExtension } from "@earendil-works/pi-durable/tool-search";
import { createCodingTools, DEFAULT_IMAGE_LIMITS, type ImageProcessor } from "@earendil-works/pi-durable/tools";
import { createNodePhotonImages } from "@earendil-works/pi-durable/images/node";
import type {
	Capability,
	ExecutionEnv,
	Hook,
	Models,
	ServiceEndpoint,
	Tool,
	ToolContext,
	ToolResult,
	TranscriptItem,
} from "@yonder/sdk";
import { matchesGlob } from "../config/index.js";
import { loginWithType } from "./auth.js";
import { credentialPath, FileCredentials } from "./credentials.js";
import { localEnvironment } from "./env.js";
import { buildModels } from "./models.js";
import { createGrepTool } from "./grep.js";
import { imageMime } from "./attachments.js";
export { attachmentFromPath } from "./attachments.js";
import { observeTerminal, type TerminalUpdate } from "./terminal.js";
import { entryText as textOf, transcriptItem } from "./transcript.js";
import type { RuntimeInput, RuntimeOptions, RuntimeRun, RuntimeSessionConfig, RuntimeSessionState } from "./types.js";

export { type LoginInteraction, loginProvider } from "./auth.js";
export { credentialPath, FileCredentials } from "./credentials.js";
export { canonicalPath, localEnvironment, workspaceFiles } from "./env.js";
export type { TerminalUpdate } from "./terminal.js";
export { readTranscript } from "./transcript.js";
export type * from "./types.js";

const SessionDoc = defineDoc({
	kind: "yonder.session",
	version: 1,
	scope: "conversation",
	history: "latest",
	fork: "current",
	initial: () => ({
		agent: null as string | null,
		profile: "",
		cwd: "",
		env: "local",
		capabilities: null as Capability[] | null,
		close: "run-end" as "run-end" | "manual",
	}),
});
const cid = (id: string) => Number(id) as ConversationId;
const emptyUsage = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 });
export function submissionOutcome(
	done: { status: "done" } | { status: "unanswered"; reason: string },
	limitReason?: string,
): { status: RuntimeRun["status"]; reason?: string } {
	if (limitReason) return { status: "limit", reason: limitReason };
	if (done.status === "done") return { status: "done" };
	return {
		status: done.reason.includes("abort") ? "aborted" : "error",
		reason: done.reason,
	};
}
const RunDoc = defineDocFamily({
	kind: "yonder.run",
	version: 1,
	family: true,
	scope: "conversation",
	history: "latest",
	fork: "initial",
	initial: (_seed: null) => ({
		config: "",
		started: 0,
		turns: 0,
		previous: "",
		repeats: 0,
		reason: null as string | null,
		usageBefore: emptyUsage(),
	}),
});
const capabilityMap: Record<string, Capability[]> = {
	read: ["read"],
	write: ["write"],
	edit: ["write"],
	bash: ["exec"],
	tool_search: [],
};
const toResult = (value: ToolResult): ToolExecutionResult => ({
	output: [
		{ type: "text", text: value.text },
		...(value.images ?? []).map((image) => ({ type: "image" as const, mimeType: image.mime, data: image.data })),
	],
	isError: value.isError ?? false,
});
function fromResult(value: ToolExecutionResult): ToolResult {
	return {
		text: (value.output ?? [])
			.filter((b) => b.type === "text")
			.map((b) => b.text)
			.join("\n"),
		images: (value.output ?? []).filter((b) => b.type === "image").map((b) => ({ mime: b.mimeType, data: b.data })),
		isError: value.isError ?? false,
	};
}
interface RunState {
	usageBefore: RuntimeRun["usage"];
	id: string;
	session: string;
	config: RuntimeSessionConfig;
	turns: number;
	previous?: { name: string; args: unknown };
	repeats: number;
	reason?: string;
	timer: ReturnType<typeof setTimeout> | undefined;
	deadline: number;
}
export class Runtime {
	private harness!: Harness;
	private restoring = false;
	private images?: Promise<ImageProcessor>;
	private imageProcessor(): Promise<ImageProcessor> {
		return (this.images ??= createNodePhotonImages());
	}
	private storage!: SqliteStorage;
	private finishing = new Map<string, Promise<RuntimeRun>>();
	private recovering: Array<{ session: string; id: import("@earendil-works/pi-durable").SubmissionId }> = [];
	private registry = createRegistry();
	private extensions = new Map<string, Extension>();
	private tools = new Map<string, ToolRegistration>();
	private capabilities = new Map<string, Capability[]>(Object.entries(capabilityMap));
	private configured = new Map<string, RuntimeSessionConfig>();
	private states = new Map<string, RunState>();
	private submissions = new Map<string, { event?: RuntimeInput["event"] }>();
	private toolInvocations = new WeakMap<ToolContext, { api: ToolExecutionApi; context: Context }>();
	readonly credentials: FileCredentials;
	readonly models: Models;
	private constructor(private options: RuntimeOptions) {
		this.credentials = new FileCredentials(credentialPath(options.home, options.config.credentials));
		this.models = buildModels(this.credentials, options.config.models?.providers);
	}
	static async open(options: RuntimeOptions): Promise<Runtime> {
		const runtime = new Runtime(options);
		runtime.install();
		const storage = await SqliteStorage.open(options.db, { prefix: "pi_" });
		runtime.storage = storage;
		runtime.harness = await Harness.open(
			storage,
			{
				models: runtime.models,
				registry: runtime.registry,
				settings: { ...(options.config.compaction ? { compaction: options.config.compaction } : {}) },
				beforeAgent: (target, context) => runtime.prepareRun(String(target.conversationId), context),
				env: async (target) => {
					const doc = await target.read.snapshot(SessionDoc, target.conversationId, C);
					if (!doc) throw new Error("Missing yonder.session");
					const config =
						runtime.currentConfig(String(target.conversationId)) ??
						(await options.resolveSession(String(target.conversationId)));
					return runtime.environment(config);
				},
				...(options.onReport ? { onReport: options.onReport } : {}),
			},
			C,
		);
		return runtime;
	}
	private environment(config: RuntimeSessionConfig): ExecutionEnv {
		if (config.resolved.env === "local") return localEnvironment(config.cwd);
		const env = this.options.envs?.get(config.resolved.env);
		if (!env) throw new Error(`Unknown execution environment: ${config.resolved.env}`);
		return env;
	}
	private async context(id: string, context: Context): Promise<ToolContext> {
		const config = this.currentConfig(id) ?? (await this.options.resolveSession(id));
		const live = await this.harness.snapshot(LiveDoc, cid(id), C);
		const events = await this.sources(live?.run?.inputs ?? []);
		const input = events[0];
		return {
			agent: config.agent,
			profile: config.profile,
			session: id,
			capabilities: [...config.resolved.capabilities],
			env: this.environment(config),
			...(input ? { event: input } : {}),
			events,
			signal: context.abortSignal!,
		};
	}
	currentConfig(id: string): RuntimeSessionConfig | undefined {
		return this.configured.get(id);
	}
	async sessionConfig(id: string): Promise<RuntimeSessionConfig> {
		const live = await this.harness.snapshot(LiveDoc, cid(id), C);
		return (live?.run ? this.currentConfig(id) : undefined) ?? this.options.resolveSession(id);
	}
	private async prepareRun(session: string, context: Context): Promise<void> {
		const live = await this.harness.snapshot(LiveDoc, cid(session), context);
		if (!live?.run) return;
		const id = String(live.run.inputs[0]);
		if (this.states.has(id)) return;
		const saved = await this.harness.snapshot(RunDoc, cid(session), id, context);
		const started = saved?.started || Date.now();
		const config: RuntimeSessionConfig = saved?.config
			? JSON.parse(saved.config)
			: structuredClone(await this.options.resolveSession(session));
		const usageBefore = saved?.config ? saved.usageBefore : await this.usage(session);
		await this.applyConfiguration(session, config);
		if (!saved?.config) {
			await this.harness.commit(async (tx) => {
				Object.assign(await tx.doc(RunDoc, cid(session), id, null), {
					config: JSON.stringify(config),
					started,
					usageBefore,
				});
			}, context);
		}
		this.configured.set(session, config);
		const state: RunState = {
			id,
			session,
			config,
			usageBefore,
			turns: saved?.turns ?? 0,
			repeats: saved?.repeats ?? 0,
			...(saved?.previous ? { previous: JSON.parse(saved.previous) } : {}),
			...(saved?.reason ? { reason: saved.reason } : {}),
			timer: undefined,
			deadline: started + config.resolved.limits.maxMinutes * 60000,
		};
		if (!this.restoring) this.armTimer(state);
		this.states.set(id, state);
	}
	private armTimer(state: RunState): void {
		state.timer = setTimeout(
			() => {
				void this.abortRun(state, "maxMinutes").catch(this.options.onReport ?? (() => {}));
			},
			Math.max(0, state.deadline - Date.now()),
		);
		state.timer.unref();
	}
	private async saveRun(state: RunState): Promise<void> {
		await this.harness.commit(async (tx) => {
			Object.assign(await tx.doc(RunDoc, cid(state.session), state.id, null), {
				turns: state.turns,
				previous: state.previous ? JSON.stringify(state.previous) : "",
				repeats: state.repeats,
				reason: state.reason ?? null,
			});
		}, C);
	}
	private async abortRun(state: RunState, reason: string): Promise<void> {
		const live = await this.harness.snapshot(LiveDoc, cid(state.session), C);
		if (String(live?.run?.inputs[0]) !== state.id) return;
		state.reason ??= reason;
		await this.saveRun(state);
		if (live?.run) await this.harness.abortTask(live.run.taskId, C);
	}
	private async runState(api: HookApi, context: Context): Promise<RunState> {
		const live = await api.snapshot(LiveDoc, api.conversationId, context);
		const id = String(live?.run?.inputs[0] ?? api.taskId);
		const state = this.states.get(id);
		if (!state) throw new Error(`Missing active run ${id}`);

		return state;
	}
	private async stop(context: Context, state: RunState, reason: string): Promise<never> {
		const signal = context.abortSignal!;
		signal.throwIfAborted();
		const stopped = once(signal, "abort");
		// Abort must run outside this hook: abort() joins the invocation being stopped.
		void this.abortRun(state, reason).catch(this.options.onReport ?? (() => {}));
		await stopped;
		throw signal.reason;
	}
	private install() {
		const core = defineExtension({
			name: "yonder.core",
			sections: [
				section(
					"yonder",
					async (input, context) => {
						await input.read.snapshot(SessionDoc, input.conversationId, context);
						const config = this.currentConfig(String(input.conversationId));
						if (!config) throw new Error("Missing active configuration");
						return (
							await this.options.sections?.({ ...config, id: String(input.conversationId) }, context.abortSignal)
						)?.join("\n\n");
					},
					{ tag: false },
				),
			],
			hooks: [
				hook(GenerationTask, {
					beforeRequest: async (request, api, context) => {
						const state = await this.runState(api, context);
						if (state.reason) await this.stop(context, state, state.reason);
						if (state.turns >= state.config.resolved.limits.maxTurns) await this.stop(context, state, "maxTurns");
						const model = this.models.getModel(
							state.config.resolved.model.split("/")[0]!,
							state.config.resolved.model.slice(state.config.resolved.model.indexOf("/") + 1),
						);
						const limits = model?.inputLimits,
							images = request.messages.flatMap((message) =>
								Array.isArray(message.content) ? message.content.filter((block) => block.type === "image") : [],
							);
						if (images.length && !model?.input.includes("image"))
							throw new Error("Current model cannot accept images already in conversation history");
						if (
							images.length > (limits?.images?.maxPerRequest ?? Infinity) ||
							request.messages.some(
								(message) =>
									Array.isArray(message.content) &&
									message.content.filter((block) => block.type === "image").length >
										(limits?.images?.maxPerMessage ?? Infinity),
							)
						)
							throw new Error("Conversation image count exceeds the current model's input limit; history was retained");
						if (Buffer.byteLength(JSON.stringify(request.messages)) > (limits?.maxRequestBytes ?? Infinity))
							throw new Error(
								"Conversation input exceeds the current model's request byte limit; history was retained",
							);
						state.turns++;
						await this.saveRun(state);
					},
					afterTools: async (_assistant, _results, api, context) => {
						const state = await this.runState(api, context);
						if (state.turns >= state.config.resolved.limits.maxTurns) await this.stop(context, state, "maxTurns");
					},
				}),
				hook(ToolTask, {
					beforeTool: async (call, api, context) => {
						const state = await this.runState(api, context);
						const callKey = { name: call.name, args: call.arguments };
						state.repeats = isDeepStrictEqual(callKey, state.previous) ? state.repeats + 1 : 1;
						state.previous = structuredClone(callKey);
						await this.saveRun(state);
						if (state.repeats >= state.config.resolved.limits.repeatStop) await this.stop(context, state, "repeatStop");
						if (state.repeats >= state.config.resolved.limits.repeatBlock)
							return { block: "相同工具调用已重复，请换一种方法。" };
						const config = state.config;
						const denied = await this.toolDenied(
							call.name,
							call.arguments as JsonObject,
							config,
							context,
							String(api.conversationId),
						);
						if (denied) return { block: denied };
					},
				}),
			],
		});
		this.registry.install(core);
		this.extensions.set(core.name, core);
		const codingTools = createCodingTools({
			images: { prepare: async (...args) => (await this.imageProcessor()).prepare(...args) },
		});
		const coding = defineExtension({
			...codingTools,
			name: "yonder.files",
			tools: (codingTools.tools ?? []).map((t) => ({ ...t, deferred: true })),
		});
		this.registry.install(coding);
		this.extensions.set(coding.name, coding);
		const search = createToolSearchExtension();
		this.registry.install(search);
		this.extensions.set(search.name, search);
		for (const extension of [coding, search]) for (const tool of extension.tools ?? []) this.tools.set(tool.name, tool);
		const builtins = this.adapter("yonder.tools", [createGrepTool(), ...(this.options.tools ?? [])], []);
		this.registry.install(builtins);
		this.extensions.set(builtins.name, builtins);
		for (const plugin of this.options.plugins ?? []) {
			const extension = this.adapter(`plugin:${plugin.id}`, plugin.tools, plugin.hooks);
			this.registry.install(extension);
			this.extensions.set(extension.name, extension);
		}
	}
	private adapter(name: string, tools: Tool[], hooks: Hook[]): Extension {
		const registrations = tools.map((tool) => {
			this.capabilities.set(tool.name, tool.capabilities);
			const registration = defineTool({
				name: tool.name,
				description: tool.description,
				parameters: tool.parameters,
				deferred: true,
				...(tool.name === "task_run" ? { replay: "safe" as const } : {}),
				execute: async (args, api, context) => {
					const ctx = await this.context(String(api.conversationId), context);
					this.toolInvocations.set(ctx, { api, context });
					return toResult(await tool.execute(args, ctx));
				},
			});
			this.tools.set(tool.name, registration);
			return registration;
		});
		return defineExtension({
			name,
			tools: registrations,
			hooks: hooks.flatMap((plugin) => [
				hook(ToolTask, {
					beforeTool: async (call, api, context) => {
						const result = await plugin.beforeTool?.(
							{ id: call.id, name: call.name, args: call.arguments },
							await this.context(String(api.conversationId), context),
						);
						return result
							? "block" in result
								? { block: result.block }
								: { arguments: result.args as JsonObject }
							: undefined;
					},
					afterTool: async (call, result, api, context) => {
						const replacement = await plugin.afterTool?.(
							{ id: call.id, name: call.name, args: call.arguments },
							fromResult(result),
							await this.context(String(api.conversationId), context),
						);
						return replacement ? { ...result, ...toResult(replacement.result) } : undefined;
					},
				}),
				hook(GenerationTask, {
					beforeRequest: async (request, api, context) =>
						plugin.beforeRequest?.([...request.messages], await this.context(String(api.conversationId), context)),
				}),
			]),
		});
	}
	private async toolDenied(
		name: string,
		args: JsonObject,
		config: RuntimeSessionConfig,
		context: Context,
		session: string,
	): Promise<string | undefined> {
		const missing = (this.capabilities.get(name) ?? []).filter((c) => !config.resolved.capabilities.includes(c));
		if (missing.length) return `缺少能力：${missing.join(", ")}`;
		if (!["read", "write", "edit", "grep"].includes(name)) return;
		if (name === "grep" && args.path === undefined) args = { ...args, path: "." };
		if (typeof args.path !== "string") return;
		const env = this.environment(config);
		const canonical = async (path: string): Promise<string> => {
			const result = await env.canonicalPath(path, context);
			if (result.ok) return result.value;
			if (result.error.code !== "not_found") throw result.error;
			const absolute = getOrThrow(await env.absolutePath(path, context));
			const parent = dirname(absolute);
			if (parent === absolute) throw result.error;
			return getOrThrow(await env.joinPath([await canonical(parent), absolute.slice(parent.length)], context));
		};
		const target = await canonical(args.path),
			cwd = await canonical(config.cwd);
		if (!config.resolved.capabilities.includes("exec")) {
			const rel = relative(cwd, target);
			if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) {
				const ctx = await this.contextForAttachment(session, context);
				const allowed = (name === "read" || name === "grep") && ctx.some((a) => a === target);
				if (!allowed) return "文件路径超出当前工作区。";
			}
		}
		if (name !== "read" && name !== "grep")
			for (const file of [{ path: "agent.yaml", capability: "admin" as const }, ...(config.protectedFiles ?? [])]) {
				const protectedPath = await canonical(getOrThrow(await env.joinPath([config.cwd, file.path], context)));
				if (target === protectedPath && !config.resolved.capabilities.includes(file.capability))
					return `受保护文件需要 ${file.capability} 能力。`;
			}
	}
	private async contextForAttachment(session: string, context: Context): Promise<string[]> {
		const ctx = await this.context(session, context);
		const attachments = (ctx.events ?? (ctx.event ? [ctx.event] : [])).flatMap(
			(event) => (event.data as { attachments?: Array<{ uri: string }> }).attachments ?? [],
		);
		const paths: string[] = [];
		for (const attachment of attachments) {
			const path = attachment.uri.startsWith("file:") ? fileURLToPath(attachment.uri) : attachment.uri;
			if (!isAbsolute(path)) continue;
			const canonical = await ctx.env.canonicalPath(path, context);
			if (canonical.ok) paths.push(canonical.value);
		}
		return paths;
	}

	async create(meta: {
		agent: string | null;
		profile: string;
		cwd: string;
		env?: string;
		capabilities?: Capability[];
		close?: "run-end" | "manual";
	}): Promise<string> {
		const conversation = await this.harness.createConversation(
			{
				ownership: { kind: "ownerless" },
				init: async (tx, id) => {
					Object.assign(await tx.doc(SessionDoc, id), {
						agent: meta.agent,
						profile: meta.profile,
						cwd: meta.cwd,
						env: meta.env ?? "local",
						capabilities: meta.capabilities ?? null,
						close: meta.close ?? "run-end",
					});
				},
			},
			C,
		);
		return String(conversation.id);
	}
	async sessionState(id: string): Promise<RuntimeSessionState | undefined> {
		const state = await this.harness.snapshot(SessionDoc, cid(id), C);
		if (!state) return;
		return {
			agent: state.agent,
			profile: state.profile,
			close: state.close ?? "run-end",
			cwd: state.cwd,
			env: state.env,
			...(state.capabilities ? { capabilities: [...state.capabilities] } : {}),
		};
	}
	async setSessionState(id: string, state: RuntimeSessionState): Promise<void> {
		await (await this.conversation(id)).commit(async (tx) => {
			Object.assign(await tx.doc(SessionDoc, cid(id)), { ...state, capabilities: state.capabilities ?? null });
		}, C);
		this.configured.delete(id);
	}
	describeTools(config: RuntimeSessionConfig) {
		return [...this.tools.values()].map((tool) => {
			const extension = [...this.extensions.values()].find((item) => item.tools?.includes(tool));
			const plugin = extension?.name.startsWith("plugin:") ? extension.name.slice(7) : undefined;
			const missing = (this.capabilities.get(tool.name) ?? []).filter(
				(capability) => !config.resolved.capabilities.includes(capability),
			);
			const selected = !plugin || config.resolved.plugins.includes(plugin);
			const offered = config.resolved.tools.offer.some((pattern) => matchesGlob(pattern, tool.name));
			const deferred = config.resolved.tools.search.some((pattern) => matchesGlob(pattern, tool.name));
			return {
				name: tool.name,
				capabilities: this.capabilities.get(tool.name) ?? [],
				exposure: !selected
					? "plugin-not-selected"
					: missing.length
						? "capability-denied"
						: offered
							? "offer"
							: deferred
								? "search"
								: "not-selected",
				missing,
			};
		});
	}
	async configure(id: string): Promise<void> {
		if ((await this.harness.snapshot(LiveDoc, cid(id), C))?.run) return;
		await this.applyConfiguration(id, await this.options.resolveSession(id));
	}
	private async applyConfiguration(id: string, config: RuntimeSessionConfig): Promise<void> {
		const profile = config.resolved;
		const selected = ["yonder.core", "yonder.files", "yonder.tools", ...profile.plugins.map((id) => `plugin:${id}`)];
		const available = [...this.tools.values()].filter((t) => {
			const extension = [...this.extensions.values()].find((e) => e.tools?.includes(t));
			return (
				extension &&
				selected.includes(extension.name) &&
				(this.capabilities.get(t.name) ?? []).every((c) => profile.capabilities.includes(c))
			);
		});
		const offered = available.filter((t) => profile.tools.offer.some((pattern) => matchesGlob(pattern, t.name)));
		const deferred = available.filter(
			(t) => profile.tools.search.some((pattern) => matchesGlob(pattern, t.name)) && !offered.includes(t),
		);
		if (deferred.length) {
			const search = [...this.extensions.values()].find((e) => e.tools?.some((t) => t.name === "tool_search"));
			if (search) {
				selected.push(search.name);
				for (const t of search.tools ?? []) {
					available.push(t);
					offered.push(t);
				}
			}
		}
		const tools = [...new Set([...offered, ...deferred])];
		const conversation = await this.conversation(id);
		const model = {
			provider: profile.model.slice(0, profile.model.indexOf("/")),
			modelId: profile.model.slice(profile.model.indexOf("/") + 1),
		};
		const current = await this.harness.snapshot(AgentDoc, cid(id), C);
		const same =
			current &&
			JSON.stringify(current.model) === JSON.stringify(model) &&
			current.thinkingLevel === profile.thinking &&
			JSON.stringify(current.extensions) === JSON.stringify(selected) &&
			JSON.stringify(current.tools) === JSON.stringify(tools.map((t) => t.name)) &&
			JSON.stringify(current.modelTools) === JSON.stringify(offered.map((t) => t.name)) &&
			current.instructions === profile.instructions &&
			current.cwd === config.cwd;
		if (!same)
			await conversation.configure(
				{
					model,
					thinkingLevel: profile.thinking,
					extensions: selected.map((name) => {
						const e = this.extensions.get(name);
						if (!e) throw new Error(`Unknown runtime extension: ${name}`);
						return e;
					}),
					tools,
					modelTools: offered,
					instructions: profile.instructions,
					cwd: config.cwd,
				},
				C,
			);
		const metadata = await this.harness.snapshot(SessionDoc, cid(id), C);
		if (metadata?.agent !== config.agent || metadata?.profile !== config.profile)
			await conversation.commit(async (tx) => {
				Object.assign(await tx.doc(SessionDoc, cid(id)), { agent: config.agent, profile: config.profile });
			}, C);
		this.configured.set(id, config);
	}
	private async conversation(id: string) {
		const value = await this.harness.conversation(cid(id), C);
		if (!value) throw new Error(`Unknown conversation: ${id}`);
		return value;
	}
	private async inputContent(id: string, input: RuntimeInput) {
		const config = await this.options.resolveSession(id),
			env = this.environment(config);
		const preparation = withAbortSignal(AbortSignal.timeout(Math.ceil(config.resolved.limits.maxMinutes * 60000)), C);
		const content: Array<{ type: "text"; text: string } | { type: "image"; mimeType: string; data: string }> = [
			{ type: "text", text: input.text },
		];
		const model = this.models.getModel(
			config.resolved.model.slice(0, config.resolved.model.indexOf("/")),
			config.resolved.model.slice(config.resolved.model.indexOf("/") + 1),
		);
		let count = 0;
		const actual = new Map<string, { mime: string; bytes: number }>();
		for (const attachment of input.attachments ?? [])
			if (attachment.kind === "image") {
				const bytes = attachment.uri.startsWith("data:")
					? Buffer.from(this.imageData(attachment.uri), "base64")
					: getOrThrow(
							await env.readBinaryFile(
								attachment.uri.startsWith("file:") ? fileURLToPath(attachment.uri) : attachment.uri,
								preparation,
							),
						);
				const mime = imageMime(bytes),
					resize = model?.inputLimits?.images?.resize;
				actual.set(attachment.uri, { mime: mime ?? attachment.mime, bytes: bytes.byteLength });
				const image =
					mime && model?.input.includes("image") && count < (model.inputLimits?.images?.maxPerMessage ?? Infinity)
						? await (await this.imageProcessor()).prepare(bytes, mime, {
								maxWidth: resize?.maxWidth ?? DEFAULT_IMAGE_LIMITS.maxWidth,
								maxHeight: resize?.maxHeight ?? DEFAULT_IMAGE_LIMITS.maxHeight,
								maxBytes: resize?.maxBytes ?? DEFAULT_IMAGE_LIMITS.maxBytes,
							})
						: undefined;
				preparation.abortSignal?.throwIfAborted();
				if (image) {
					content.push({ type: "image", mimeType: image.mimeType, data: image.data });
					count++;
				} else
					content.push({
						type: "text",
						text: `attachment: ${attachment.name ?? attachment.uri} (${mime ?? attachment.mime}, ${bytes.byteLength} bytes); image could not be supplied within this model's input limits`,
					});
			}

		if (input.event) {
			const attachments = (input.event.data as { attachments?: import("@yonder/sdk").Attachment[] }).attachments ?? [];
			input.event = {
				...input.event,
				data: { ...input.event.data, attachments: attachments.map((item) => ({ ...item, ...actual.get(item.uri) })) },
			};
		}
		return content;
	}
	private inputEntry(input: RuntimeInput) {
		return {
			kind: "yonder.message",
			data: input.event
				? (JSON.parse(
						JSON.stringify({
							event: input.event.id,
							attachments: (input.event.data as { attachments?: unknown[] }).attachments ?? [],
						}),
					) as JsonObject)
				: {},
		};
	}
	async submit(id: string, input: RuntimeInput): Promise<RuntimeRun> {
		const conversation = await this.conversation(id);
		const requestId = input.event ? `event:${input.event.id}` : input.requestId;
		const existing = requestId ? await this.storage.submissionByRequest(cid(id), requestId, C) : undefined;
		const content = existing ? [] : await this.inputContent(id, input);
		let stream = input.onOutput ? await watchEvents(this.harness, cid(id), C) : undefined;
		let submission: Submission | undefined;
		let submitted!: () => void;
		const ready = new Promise<void>((resolve) => {
			submitted = resolve;
		});
		let participating = false;
		let outputRun: string | undefined;
		const textBlocks = new Map<number, string>();
		stream?.start(async (events) => {
			await ready;
			for (const event of events) {
				if (event.type === "run_start" || event.type === "snapshot")
					participating =
						!!submission &&
						(event.type === "run_start" ? event.inputs : (event.run?.inputs ?? [])).includes(submission.id);
				if (event.type === "run_start" || event.type === "snapshot")
					outputRun = String((event.type === "run_start" ? event.inputs : event.run?.inputs)?.[0] ?? "");
				if (
					event.type === "submission" &&
					submission &&
					event.record.id === submission.id &&
					event.record.status === "placed"
				)
					participating = true;
				if (participating) {
					if (!outputRun) outputRun = String((await this.harness.snapshot(LiveDoc, cid(id), C))?.run?.inputs[0] ?? "");
					this.output(event, { ...input, onOutput: (part) => input.onOutput?.(part, outputRun) }, textBlocks);
				}
				if (event.type === "run_end") participating = false;
			}
		});
		const entry = this.inputEntry(input);
		try {
			submission = existing
				? await this.harness.submission(existing.id, C)
				: await conversation.submit(
						input.wake === "write"
							? {
									type: "write",
									...(requestId ? { requestId } : {}),
									entry: { ...entry, model: [{ role: "user", content, timestamp: Date.now() }] },
								}
							: {
									type: "input",
									...(requestId ? { requestId } : {}),
									content,
									entry,
									whenBusy: input.busy === "steer" ? "steer" : "followUp",
								},
						C,
					);
			if (!submission) throw new Error("Previously admitted submission disappeared");
			await this.attachSubmission(submission, input.event, id);
			try {
				await this.options.onAdmitted?.(id, input);
			} catch (error) {
				this.options.onReport?.(error);
			}
			submitted();
			const done = await submission.wait(C);
			await stream?.stop();
			stream = undefined;
			if (input.wake === "write") {
				this.submissions.delete(String(submission.id));
				return {
					runId: String(submission.id),
					...submissionOutcome(done),
					text: "",
					usage: emptyUsage(),
					inputs: input.event ? [input.event.id] : [],
				};
			}
			return await this.settledRun(id, done);
		} finally {
			submitted();
			await stream?.stop();
		}
	}
	private imageData(uri: string): string {
		const match = /^data:[^;,]+;base64,([A-Za-z0-9+/]*={0,2})$/.exec(uri);
		if (!match?.[1]) throw new Error("Image data URI must contain base64 data");
		return match[1];
	}

	private async attachSubmission(
		submission: Submission,
		event: RuntimeInput["event"],
		_session: string,
	): Promise<void> {
		this.submissions.set(String(submission.id), { event });
	}

	private output(event: AgentEvent, input: RuntimeInput, textBlocks: Map<number, string>) {
		const text = (index: number, value: string) => {
			const previous = textBlocks.get(index) ?? "";
			textBlocks.set(index, value);
			const delta = value.startsWith(previous) ? value.slice(previous.length) : value;
			if (delta) input.onOutput?.({ type: "text", delta });
		};
		const content = (blocks: Array<{ type: string; text?: string }>) =>
			blocks.forEach((block, index) => {
				if (block.type === "text") text(index, block.text ?? "");
			});
		if (event.type === "message_start" && event.message.role === "assistant") {
			textBlocks.clear();
			content(event.message.content);
		}
		if (event.type === "message_end")
			for (const message of event.entry.model ?? []) if (message.role === "assistant") content(message.content);
		if (event.type === "message_update")
			for (const change of event.changes) {
				if (change.type === "text_delta")
					text(change.contentIndex, (textBlocks.get(change.contentIndex) ?? "") + change.delta);
				else if (change.type === "message") content(change.message.content);
				else if ((change.type === "text_start" || change.type === "block") && change.block?.type === "text")
					text(change.contentIndex, change.block.text);
			}
		if (event.type === "tool_execution_start") input.onOutput?.({ type: "tool", phase: "start", name: event.toolName });
		if (event.type === "tool_execution_end")
			input.onOutput?.({
				type: "tool",
				phase: "end",
				name: event.toolName,
				ok: event.result
					? !event.result.isError
					: event.entry
						? !event.entry.model?.some((m) => m.role === "toolResult" && m.isError)
						: false,
			});
		if (event.type === "task_failed") input.onOutput?.({ type: "error", message: event.message });
	}
	async abort(id: string): Promise<void> {
		await (await this.conversation(id)).abort(C);
	}
	async queued(id: string, withdraw = false) {
		const inbox = await this.harness.snapshot(InboxDoc, cid(id), C);
		const result: Array<{ id: string; mode: string; text: string; event?: string }> = [];
		for (const item of inbox?.items ?? []) {
			if (item.mode === "write") continue;
			if (withdraw && (await this.harness.abortSubmission(item.id, C, cid(id))) !== "aborted") continue;
			const content =
				typeof item.content === "string"
					? item.content
					: item.content
							.filter((block) => block.type === "text")
							.map((block) => block.text)
							.join("\n");
			const event =
				item.entry?.data && typeof item.entry.data === "object" && "event" in item.entry.data
					? String(item.entry.data.event)
					: undefined;
			result.push({ id: String(item.id), mode: item.mode, text: content, ...(event ? { event } : {}) });
		}
		return result;
	}

	async observe(id: string, send: (update: TerminalUpdate) => Promise<void>) {
		let runId: string | undefined,
			eventIds: string[] = [];
		return observeTerminal(this.harness, id, async (update) => {
			if (update.inputs) {
				runId = update.inputs[0];
				eventIds = (await this.sources(update.inputs.map(Number))).map((event) => event.id);
			}
			await send({ ...update, session: id, ...(runId ? { runId } : {}), eventIds });
		});
	}
	async terminalHistory(id: string) {
		const page = await (await this.conversation(id)).entries(
			{ order: "ascending" },
			Number.MAX_SAFE_INTEGER,
			undefined,
			C,
		);
		return page.items.flatMap((entry) => entry.model ?? []);
	}

	async transcript(id: string, range: { from?: number; limit?: number } = {}): Promise<TranscriptItem[]> {
		const page = await (await this.conversation(id)).entries(
			{ order: "ascending" },
			Number.MAX_SAFE_INTEGER,
			undefined,
			C,
		);
		return page.items
			.map(transcriptItem)
			.filter((entry) => range.from === undefined || entry.id >= range.from)
			.slice(0, range.limit ?? 100);
	}
	async usage(id: string): Promise<RuntimeRun["usage"]> {
		const state = await this.harness.snapshot(UsageDoc, cid(id), C),
			sum = emptyUsage();
		for (const usage of [...Object.values(state?.models ?? {}), ...Object.values(state?.tools ?? {})]) {
			sum.input += usage.input;
			sum.output += usage.output;
			sum.cacheRead += usage.cacheRead;
			sum.cacheWrite += usage.cacheWrite;
			sum.cost += usage.cost.total;
		}
		return sum;
	}
	async runTask(ctx: ToolContext, initialize: (childId: string) => Promise<RuntimeInput>): Promise<RuntimeRun> {
		const invocation = this.toolInvocations.get(ctx);
		if (!invocation) throw new Error("task_run requires an active runtime tool invocation");
		const { api, context } = invocation;
		const child = await api.commit(async (tx) => {
			const existing = await tx.scanConversations({ ownerTaskId: api.taskId }, 1);
			if (existing.items[0]) return existing.items[0].id;
			const created = await tx.createConversation({ ownership: { kind: "task", taskId: api.taskId } });
			await tx.doc(SessionDoc, created.id);
			return created.id;
		}, context);
		const input = await initialize(String(child));
		const handle = await api.conversation(child, context);
		if (!handle) throw new Error("Child conversation is missing");
		// Invocation-bound submit preserves pi task ownership and idempotent task request IDs.
		const prior = await api.commit((tx) => tx.submissionByRequest(child, `task:${api.taskId}`), context);
		const submission = await handle.submit(
			{
				type: "input",
				content: prior ? [] : await this.inputContent(String(child), input),
				requestId: `task:${api.taskId}`,
				entry: this.inputEntry(input),
			},
			context,
		);
		await this.attachSubmission(submission, input.event, String(child));
		try {
			await this.options.onAdmitted?.(String(child), input);
		} catch (error) {
			this.options.onReport?.(error);
		}
		const done = await submission.wait(context);
		return this.settledRun(String(child), done);
	}
	private async sources(ids: readonly number[]): Promise<import("@yonder/sdk").YEvent[]> {
		const events: import("@yonder/sdk").YEvent[] = [];
		for (const id of ids) {
			const record = await this.storage.submission(id as import("@earendil-works/pi-durable").SubmissionId, C);
			const entry = record?.entry ? await this.harness.commit((tx) => tx.entry(record.entry!), C) : undefined;
			const data = entry?.data as { event?: string; attachments?: import("@yonder/sdk").Attachment[] } | undefined;
			const event =
				(data?.event ? await this.options.readEvent?.(data.event) : undefined) ??
				this.submissions.get(String(id))?.event;
			if (data?.event && !event) throw new Error(`submission ${id} 的来源事件 ${data.event} 不可恢复`);
			if (event)
				events.push(data?.attachments ? { ...event, data: { ...event.data, attachments: data.attachments } } : event);
		}
		return events;
	}
	private sumUsage(state?: Readonly<UsageState>): RuntimeRun["usage"] {
		const sum = emptyUsage();
		for (const usage of [...Object.values(state?.models ?? {}), ...Object.values(state?.tools ?? {})]) {
			for (const key of ["input", "output", "cacheRead", "cacheWrite"] as const) sum[key] += usage[key];
			sum.cost += usage.cost.total;
		}
		return sum;
	}
	private async receiptRun(session: string, key: string, receipt: Readonly<RunReceiptState>): Promise<RuntimeRun> {
		const finishKey = `${session}\0${key}`;
		const existing = this.finishing.get(finishKey);
		if (existing) return existing;
		const promise = (async () => {
			const saved = await this.harness.snapshot(RunDoc, cid(session), key, C);
			if (!saved?.config || !receipt.settlement)
				throw new Error(`运行 ${session}/${key} 缺少开始配置或终结凭据，历史结果不可确定`);
			const config: RuntimeSessionConfig = JSON.parse(saved.config);
			const usage = this.sumUsage(receipt.usage);
			for (const field of Object.keys(usage) as Array<keyof typeof usage>) usage[field] -= saved.usageBefore[field];
			const settlement = receipt.settlement;
			const answer =
				settlement.status === "done" ? await this.harness.commit((tx) => tx.entry(settlement.answer), C) : undefined;
			const inputs = (await this.sources(receipt.inputs)).map((event) => event.id);
			const run: RuntimeRun = {
				runId: key,
				config,
				...submissionOutcome(settlement, saved.reason ?? undefined),
				text: textOf(answer),
				inputs,
				usage,
			};
			try {
				await this.options.onRun?.(session, run);
			} finally {
				const state = this.states.get(key);
				if (state) {
					clearTimeout(state.timer);
					this.states.delete(key);
				}
				for (const input of receipt.inputs) this.submissions.delete(String(input));
				if (this.configured.get(session) === state?.config) this.configured.delete(session);
			}
			return run;
		})();
		this.finishing.set(finishKey, promise);
		try {
			return await promise;
		} finally {
			this.finishing.delete(finishKey);
		}
	}
	// ponytail: scan native receipts; use an upstream lookup if long-session cost becomes measurable.
	private async settledRun(session: string, done: Awaited<ReturnType<Submission["wait"]>>): Promise<RuntimeRun> {
		const receipts = await this.storage.scanDocuments(
			{ scope: { kind: "conversation", conversationId: cid(session) }, kind: "pi.run-receipt", at: "current" },
			Number.MAX_SAFE_INTEGER,
			undefined,
			C,
		);
		for (const doc of receipts.items) {
			const receipt = await this.harness.snapshot(RunReceiptDoc, cid(session), doc.key!, C);
			if (receipt?.inputs.includes(done.id)) return this.receiptRun(session, doc.key!, receipt);
		}
		if (done.status === "unanswered" && !done.entry) {
			const source =
				this.submissions.get(String(done.id))?.event ??
				(done.requestId?.startsWith("event:") ? await this.options.readEvent?.(done.requestId.slice(6)) : undefined);
			const run: RuntimeRun = {
				runId: `unplaced:${done.id}`,
				...submissionOutcome(done),
				text: "",
				usage: emptyUsage(),
				inputs: source ? [source.id] : [],
			};
			await this.options.onRun?.(session, run);
			this.submissions.delete(String(done.id));
			return run;
		}
		throw new Error(`submission ${done.id} 无原生回执，历史运行归属不可确定`);
	}
	/** Read and project durable endings before any submit/wait/resume starts scheduling. */
	async recover(): Promise<void> {
		this.restoring = true;
		const conversations = await this.storage.scanConversations({}, Number.MAX_SAFE_INTEGER, undefined, C);
		for (const conversation of conversations.items) {
			const covered = new Set<number>();
			const docs = await this.storage.scanDocuments(
				{ scope: { kind: "conversation", conversationId: conversation.id }, kind: "pi.run-receipt", at: "current" },
				Number.MAX_SAFE_INTEGER,
				undefined,
				C,
			);
			for (const doc of docs.items) {
				const receipt = await this.harness.snapshot(RunReceiptDoc, conversation.id, doc.key!, C);
				for (const input of receipt?.inputs ?? []) covered.add(input);
				if (receipt) {
					try {
						await this.receiptRun(String(conversation.id), doc.key!, receipt);
					} catch (error) {
						this.options.onReport?.(error);
					}
				}
			}
			const live = await this.harness.snapshot(LiveDoc, conversation.id, C);
			if (live?.run) await this.prepareRun(String(conversation.id), C);
			const records = await this.storage.scanSubmissions(
				{ conversationId: conversation.id },
				Number.MAX_SAFE_INTEGER,
				undefined,
				C,
			);
			for (const record of records.items) {
				if (record.type !== "input") continue;
				if (record.status === "queued" || record.status === "placed")
					this.recovering.push({ session: String(conversation.id), id: record.id });
				else if (!record.entry) {
					try {
						await this.settledRun(String(conversation.id), record);
					} catch (error) {
						this.options.onReport?.(error);
					}
				} else if (!covered.has(record.id))
					this.options.onReport?.(
						new Error(`历史 submission ${record.id} 无原生回执，归属/结束用量不可确定；不重新执行`),
					);
			}
		}
	}
	resume(): void {
		this.restoring = false;
		for (const state of this.states.values()) if (!state.timer) this.armTimer(state);
		for (const item of this.recovering.splice(0)) {
			void (async () => {
				const submission = await this.harness.submission(item.id, C);
				if (submission) await this.settledRun(item.session, await submission.wait(C));
			})().catch(this.options.onReport ?? (() => {}));
		}
		this.harness.resume();
	}
	async responseText(session: string, event: string): Promise<string> {
		const record = await this.storage.submissionByRequest(cid(session), `event:${event}`, C);
		return record?.status === "done" && record.answer
			? textOf(await this.harness.commit((tx) => tx.entry(record.answer!), C))
			: "";
	}
	async admitted(session: string, event: string): Promise<boolean> {
		if (await this.storage.submissionByRequest(cid(session), `event:${event}`, C)) return true;
		const inbox = await this.harness.snapshot(InboxDoc, cid(session), C);
		if (inbox?.items.some((item) => (item.entry?.data as { event?: string } | undefined)?.event === event)) return true;
		const entries = await this.storage.scanEntries(
			{ conversationId: cid(session) },
			Number.MAX_SAFE_INTEGER,
			undefined,
			C,
		);
		return entries.items.some((entry) => (entry.data as { event?: string } | undefined)?.event === event);
	}
	async resolveService(capability: string): Promise<ServiceEndpoint | undefined> {
		for (const service of this.options.config.services ?? []) {
			const selected = service.capabilities[capability];
			if (!selected) continue;
			const credential = service.credential ? await this.credentials.get(service.credential) : undefined;
			return {
				id: service.id,
				protocol: service.protocol,
				baseUrl: service.baseUrl,
				models: selected.models,
				...(selected.voices ? { voices: selected.voices } : {}),
				...(credential?.type === "api_key" && credential.key ? { apiKey: credential.key } : {}),
			};
		}
	}
	async login(provider: string, type: "api_key" | "oauth", interaction: Parameters<Models["login"]>[2]): Promise<void> {
		await loginWithType(this.models, this.options.home, provider, type, interaction);
	}

	async close(): Promise<void> {
		for (const state of this.states.values()) clearTimeout(state.timer);
		await this.harness.close(C);
	}
}
