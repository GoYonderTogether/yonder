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
	type JsonObject,
	LiveDoc,
	type Submission,
	section,
	type ToolExecutionApi,
	type ToolExecutionResult,
	type ToolRegistration,
	ToolTask,
	UsageDoc,
	watchEvents,
} from "@earendil-works/pi-durable";
import { getOrThrow } from "@earendil-works/pi-durable/env";
import { SqliteStorage } from "@earendil-works/pi-durable/storage/sqlite";
import { createToolSearchExtension } from "@earendil-works/pi-durable/tool-search";
import { createCodingTools } from "@earendil-works/pi-durable/tools";
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
import { entryText as textOf, transcriptItem } from "./transcript.js";
import type { RuntimeInput, RuntimeOptions, RuntimeRun, RuntimeSessionConfig, RuntimeSessionState } from "./types.js";

export { type LoginInteraction, loginProvider } from "./auth.js";
export { credentialPath, FileCredentials } from "./credentials.js";
export { canonicalPath, localEnvironment, workspaceFiles } from "./env.js";
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
	}),
});
const cid = (id: string) => Number(id) as ConversationId;
const emptyUsage = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 });
export function submissionOutcome(
	done: Awaited<ReturnType<Submission["wait"]>>,
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
	inputs: Set<string>;
	timer: ReturnType<typeof setTimeout>;
}
export class Runtime {
	private harness!: Harness;
	private registry = createRegistry();
	private extensions = new Map<string, Extension>();
	private tools = new Map<string, ToolRegistration>();
	private capabilities = new Map<string, Capability[]>(Object.entries(capabilityMap));
	private configured = new Map<string, RuntimeSessionConfig>();
	private states = new Map<string, RunState>();
	private submissions = new Map<string, { event?: RuntimeInput["event"]; run?: RunState; runId?: string }>();
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
		const input = live?.run?.inputs.map((value) => this.submissions.get(String(value))?.event).find(Boolean);
		return {
			agent: config.agent,
			profile: config.profile,
			session: id,
			capabilities: [...config.resolved.capabilities],
			env: this.environment(config),
			...(input ? { event: input } : {}),
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
		if (!saved?.config) {
			await this.applyConfiguration(session, config);
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
			inputs: new Set(),
			timer: setTimeout(
				() => {
					void this.abortRun(state, "maxMinutes").catch(this.options.onReport ?? (() => {}));
				},
				Math.max(0, started + config.resolved.limits.maxMinutes * 60000 - Date.now()),
			),
		};
		state.timer.unref();
		this.states.set(id, state);
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
		for (const input of live?.run?.inputs ?? []) {
			const metadata = this.submissions.get(String(input));
			if (metadata) {
				metadata.run = state;
				if (metadata.event) state.inputs.add(metadata.event.id);
			}
		}
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
					beforeRequest: async (_request, api, context) => {
						const state = await this.runState(api, context);
						if (state.reason) await this.stop(context, state, state.reason);
						if (state.turns >= state.config.resolved.limits.maxTurns) await this.stop(context, state, "maxTurns");
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
		const coding = defineExtension({
			...createCodingTools(),
			name: "yonder.files",
			tools: (createCodingTools().tools ?? []).map((t) => ({ ...t, deferred: true })),
		});
		this.registry.install(coding);
		this.extensions.set(coding.name, coding);
		const search = createToolSearchExtension();
		this.registry.install(search);
		this.extensions.set(search.name, search);
		for (const extension of [coding, search]) for (const tool of extension.tools ?? []) this.tools.set(tool.name, tool);
		const builtins = this.adapter("yonder.tools", this.options.tools ?? [], []);
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
		if (!["read", "write", "edit"].includes(name) || typeof args.path !== "string") return;
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
				const allowed = name === "read" && ctx.some((a) => a === target);
				if (!allowed) return "文件路径超出当前工作区。";
			}
		}
		if (name !== "read")
			for (const file of [{ path: "agent.yaml", capability: "admin" as const }, ...(config.protectedFiles ?? [])]) {
				const protectedPath = await canonical(getOrThrow(await env.joinPath([config.cwd, file.path], context)));
				if (target === protectedPath && !config.resolved.capabilities.includes(file.capability))
					return `受保护文件需要 ${file.capability} 能力。`;
			}
	}
	private async contextForAttachment(session: string, context: Context): Promise<string[]> {
		const ctx = await this.context(session, context);
		const attachments = (ctx.event?.data as { attachments?: Array<{ uri: string }> } | undefined)?.attachments ?? [];
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
	async submit(id: string, input: RuntimeInput): Promise<RuntimeRun> {
		const conversation = await this.conversation(id);
		const config = await this.options.resolveSession(id),
			env = this.environment(config);
		const preparation = withAbortSignal(AbortSignal.timeout(Math.ceil(config.resolved.limits.maxMinutes * 60000)), C);
		const content: Array<{ type: "text"; text: string } | { type: "image"; mimeType: string; data: string }> = [
			{ type: "text", text: input.text },
		];
		for (const attachment of input.attachments ?? [])
			if (attachment.kind === "image") {
				const data = attachment.uri.startsWith("data:")
					? this.imageData(attachment.uri)
					: Buffer.from(
							getOrThrow(
								await env.readBinaryFile(
									attachment.uri.startsWith("file:") ? fileURLToPath(attachment.uri) : attachment.uri,
									preparation,
								),
							),
						).toString("base64");
				content.push({ type: "image", mimeType: attachment.mime, data });
			}
		const stream = input.onOutput ? await watchEvents(this.harness, cid(id), C) : undefined;
		let submission: Submission | undefined;
		let submitted!: () => void;
		const ready = new Promise<void>((resolve) => {
			submitted = resolve;
		});
		let participating = false;
		const textBlocks = new Map<number, string>();
		stream?.start(async (events) => {
			await ready;
			for (const event of events) {
				if (event.type === "run_start" || event.type === "snapshot")
					participating =
						!!submission &&
						(event.type === "run_start" ? event.inputs : (event.run?.inputs ?? [])).includes(submission.id);
				if (
					event.type === "submission" &&
					submission &&
					event.record.id === submission.id &&
					event.record.status === "placed"
				)
					participating = true;
				if (participating) this.output(event, input, textBlocks);
				if (event.type === "run_end") participating = false;
			}
		});
		const before = await this.usage(id);
		const entry = { kind: "yonder.message", data: { ...(input.event ? { event: input.event.id } : {}) } };
		try {
			submission = await conversation.submit(
				input.wake === "write"
					? {
							type: "write",
							...(input.requestId ? { requestId: input.requestId } : {}),
							entry: { ...entry, model: [{ role: "user", content, timestamp: Date.now() }] },
						}
					: {
							type: "input",
							...(input.requestId ? { requestId: input.requestId } : {}),
							content,
							entry,
							whenBusy: input.busy === "steer" ? "steer" : "followUp",
						},
				C,
			);
			await this.attachSubmission(submission, input.event, id);
			submitted();
			const done = await submission.wait(C);
			const state = this.stateForSubmission(String(submission.id));
			if (state) clearTimeout(state.timer);
			const after = await this.usage(id),
				usage = emptyUsage();
			for (const key of Object.keys(usage) as Array<keyof typeof usage>)
				usage[key] = after[key] - (state?.usageBefore ?? before)[key];
			const answerId = done.status === "done" ? done.answer : undefined;
			const answer = answerId ? await this.harness.commit((tx) => tx.entry(answerId), C) : undefined;
			return {
				...(state ? { config: state.config } : {}),
				runId: state?.id ?? String(done.answer ?? submission.id),
				...submissionOutcome(done, state?.reason),
				text: textOf(answer),
				usage,
				inputs: state ? [...state.inputs] : input.event ? [input.event.id] : [],
			};
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

	private stateForSubmission(id: string): RunState | undefined {
		const metadata = this.submissions.get(id);
		return metadata?.run ?? (metadata?.runId ? this.states.get(metadata.runId) : undefined);
	}
	private async attachSubmission(submission: Submission, event: RuntimeInput["event"], session: string): Promise<void> {
		const metadata: { event?: RuntimeInput["event"]; run?: RunState; runId?: string } = { event };
		this.submissions.set(String(submission.id), metadata);
		const live = await this.harness.snapshot(LiveDoc, cid(session), C);
		if (live?.run?.inputs.includes(submission.id)) {
			metadata.runId = String(live.run.inputs[0]);
			const state = this.states.get(metadata.runId);
			if (state) {
				metadata.run = state;
				if (event) state.inputs.add(event.id);
			}
		}
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
		const submission = await handle.submit(
			{
				type: "input",
				content: input.text,
				requestId: `task:${api.taskId}`,
				entry: { kind: "yonder.message", data: input.event ? { event: input.event.id } : {} },
			},
			context,
		);
		await this.attachSubmission(submission, input.event, String(child));
		const before = await this.usage(String(child)),
			done = await submission.wait(context),
			after = await this.usage(String(child));
		const state = this.stateForSubmission(String(submission.id));
		if (state) clearTimeout(state.timer);
		const usage = emptyUsage();
		for (const key of Object.keys(usage) as Array<keyof typeof usage>)
			usage[key] = after[key] - (state?.usageBefore ?? before)[key];
		return {
			...(state ? { config: state.config } : {}),
			runId: state?.id ?? String(done.answer ?? submission.id),
			...submissionOutcome(done, state?.reason),
			text:
				done.status === "done" && done.answer
					? textOf(await this.harness.commit((tx) => tx.entry(done.answer), context))
					: "",
			usage,
			inputs: state ? [...state.inputs] : input.event ? [input.event.id] : [],
		};
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
