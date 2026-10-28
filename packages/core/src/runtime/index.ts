import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Context } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT as C, withAbortSignal } from "@earendil-works/chord/context";
import type { ModelThinkingLevel } from "@earendil-works/pi-ai";
import {
	AgentDoc,
	createRegistry,
	DEFAULT_COMPACTION_POLICY,
	defineExtension,
	defineTool,
	type EntryId,
	type Extension,
	estimateContext,
	GenerationTask,
	Harness,
	hook,
	InboxDoc,
	type JsonObject,
	LiveDoc,
	type PromptInput,
	RunReceiptDoc,
	type RunReceiptState,
	type Submission,
	section,
	selectCut,
	type TaskId,
	type ToolExecutionApi,
	type ToolRegistration,
	ToolTask,
	UsageDoc,
	watchEvents,
} from "@earendil-works/pi-durable";
import { getOrThrow } from "@earendil-works/pi-durable/env";
import { createNodePhotonImages } from "@earendil-works/pi-durable/images/node";
import { SqliteStorage } from "@earendil-works/pi-durable/storage/sqlite";
import { createToolSearchExtension } from "@earendil-works/pi-durable/tool-search";
import { createCodingTools, DEFAULT_IMAGE_LIMITS, type ImageProcessor } from "@earendil-works/pi-durable/tools";
import type {
	Attachment,
	Capability,
	ExecutionEnv,
	Hook,
	Models,
	ServiceEndpoint,
	SessionModels,
	Tool,
	ToolContext,
	TranscriptItem,
	YEvent,
} from "@yonder/sdk";
import { Type } from "typebox";
import { mergeCredentialSlots } from "../config/index.js";
import { imageMime } from "./attachments.js";
import { loginProvider } from "./auth.js";
import { createBackground } from "./background.js";
import { capabilityMap, describeCatalog } from "./catalog.js";
import { CredentialSlotStore, validateSlotPart } from "./credential-slots.js";
import { credentialPath, type FileCredentials } from "./credentials.js";
import {
	cid,
	emptyUsage,
	ModelBindingDoc,
	RunDoc,
	type RunState,
	SessionDoc,
	submissionOutcome,
	sumUsage,
} from "./docs.js";
import { requestedEffort, resolveEffort } from "./effort.js";
import { localEnvironment } from "./env.js";
import { createGrepTool } from "./grep.js";
import { RunLimits } from "./limits.js";
import {
	chainKey,
	chainRef,
	DEFAULT_FALLBACK_AFTER,
	DEFAULT_MODEL_PROBE_SECONDS,
	fallbackAliases,
	fallbackReason,
	holdSeconds,
	modelChain,
	parseAccountProvider,
	probeSeconds,
	refKey,
	splitModelRef,
} from "./model-chain.js";
import { ModelGate } from "./model-gate.js";
import { ModelHealth } from "./model-health.js";
import { accountKey, ModelQuota } from "./model-quota.js";
import { ModelWatch } from "./model-watch.js";
import { buildModels } from "./models.js";
import { writeNotification } from "./notifications.js";
import { imageData, projectOutput } from "./output.js";
import { ToolPolicy } from "./policy.js";
import { processTool } from "./process.js";
import { promptParts } from "./prompt-parts.js";
import { QuotaPoller, QuotaSource } from "./quota-source.js";
import { modelTimeouts, RESTART_NOTICE, recoveryHooks, retryPolicy } from "./recovery.js";
import { fromResult, taskReport, toResult } from "./results.js";
import { applyTodo, emptyTodos, type TodoArgs, todoDescription, todoEvent, todoParameters } from "./todo.js";

export { attachmentFromPath } from "./attachments.js";
export { inspectToolCatalog } from "./catalog.js";
export { submissionOutcome } from "./docs.js";

import { observeTerminal, type TerminalUpdate } from "./terminal.js";
import { entryText as textOf, transcriptItem } from "./transcript.js";
import type {
	RuntimeActivityExecution,
	RuntimeInput,
	RuntimeOptions,
	RuntimeRun,
	RuntimeSessionConfig,
	RuntimeSessionState,
} from "./types.js";

export { type LoginInteraction, loginProvider } from "./auth.js";
export { credentialPath, FileCredentials } from "./credentials.js";
export { canonicalPath, localEnvironment, workspaceFiles } from "./env.js";
export type { TerminalUpdate } from "./terminal.js";
export { readTranscript } from "./transcript.js";
export type * from "./types.js";

export class Runtime {
	private harness!: Harness;
	private restoring = false;
	private restartNotes = Promise.resolve();
	private interrupted: Array<{ session: string; run: string }> = [];
	private images?: Promise<ImageProcessor>;
	private imageProcessor(): Promise<ImageProcessor> {
		this.images ??= createNodePhotonImages();
		return this.images;
	}
	private storage!: SqliteStorage;
	private finishing = new Map<string, Promise<RuntimeRun>>();
	private idleWaiters = new Map<string, Set<() => void>>();
	private recovering: Array<{ session: string; id: import("@earendil-works/pi-durable").SubmissionId }> = [];
	private registry = createRegistry();
	private background!: ReturnType<typeof createBackground>;
	private rawTools = new Map<string, ToolRegistration>();
	private invocationConfigs = new WeakMap<
		Context,
		{ config: RuntimeSessionConfig; events: import("@yonder/sdk").YEvent[] }
	>();
	private extensions = new Map<string, Extension>();
	private tools = new Map<string, ToolRegistration>();
	private capabilities = new Map<string, Capability[]>(Object.entries(capabilityMap));
	private configured = new Map<string, RuntimeSessionConfig>();
	private submissions = new Map<string, { event?: RuntimeInput["event"] }>();
	private toolInvocations = new WeakMap<ToolContext, { api: ToolExecutionApi; context: Context }>();
	private readonly credentialSlots: CredentialSlotStore;
	private readonly boundModels = new WeakMap<RuntimeSessionConfig, Promise<Models>>();
	private readonly health: ModelHealth;
	private readonly quota: ModelQuota;
	private readonly gate: ModelGate;
	private readonly watch: ModelWatch;
	private readonly quotaPoller: QuotaPoller;
	readonly credentials: FileCredentials;
	private readonly policy: ToolPolicy;
	private readonly limits: RunLimits;
	readonly models: Models;
	private constructor(private options: RuntimeOptions) {
		const authPath = credentialPath(options.home, options.config.credentials);
		this.credentialSlots = new CredentialSlotStore(authPath);
		this.credentials = this.credentialSlots.defaults;
		this.health = new ModelHealth(join(options.home, ".yonder", "model-health.json"));
		this.quota = new ModelQuota(join(options.home, ".yonder", "model-quota.json"), Date.now, (error) =>
			options.onReport?.(error),
		);
		this.gate = new ModelGate(this.health, this.quota);
		this.watch = new ModelWatch({
			health: this.health,
			quota: this.quota,
			gate: this.gate,
			models: (selection) =>
				buildModels(this.credentialSlots.bind(selection), this.options.config.models?.providers, selection),
			liveIndex: async (session) => (await this.harness.snapshot(LiveDoc, cid(session), C))?.run?.modelFallback?.index,
			onHealth: (event) => this.options.onModelHealth?.(event),
			onReport: (error) => this.options.onReport?.(error),
		});
		this.quotaPoller = new QuotaPoller(new QuotaSource(authPath), this.quota, 60_000, (error) =>
			options.onReport?.(error),
		);
		this.models = buildModels(this.credentials, options.config.models?.providers);
		this.policy = new ToolPolicy({
			capabilities: this.capabilities,
			environment: (config) => this.environment(config),
			context: (session, context) => this.context(session, context),
		});
		this.limits = new RunLimits({
			harness: () => this.harness,
			models: this.models,
			onReport: options.onReport,
			onWarning: options.onWarning,
			tickIntervalMs: options.tickIntervalMs,
			onTick: async (state) => {
				const live = await this.harness.snapshot(LiveDoc, cid(state.session), C);
				if (String(live?.run?.inputs[0]) !== state.id) return;
				return options.onTick?.(state.session, {
					runId: state.id,
					started: state.started,
					tools: state.toolTasks.length,
					signal: state.visibility.signal,
					config: state.config,
					inputs: await this.sources(live?.run?.inputs ?? []),
				});
			},
			usage: (session) => this.usage(session),
			denied: (name, args, config, context, session) => this.policy.denied(name, args, config, context, session),
		});
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
				resolveModels: async (target, context) => {
					const session = String(target.conversationId);
					const key = String(target.taskId);
					const pinned = await target.read.snapshot(ModelBindingDoc, target.conversationId, key, context);
					if (pinned?.config) return runtime.modelsFor(JSON.parse(pinned.config));
					let task = await runtime.harness.getTask(target.taskId, context);
					let run: number | undefined;
					const seen = new Set<TaskId>();
					while (task && !seen.has(task.id)) {
						seen.add(task.id);
						const input = task.input as { modelRun?: number };
						if (typeof input.modelRun === "number") {
							run = input.modelRun;
							break;
						}
						if (task.owner === undefined) break;
						task = await runtime.harness.getTask(task.owner, context);
					}
					await runtime.prepareRun(session, context);
					const saved =
						run === undefined
							? undefined
							: await target.read.snapshot(RunDoc, target.conversationId, String(run), context);
					if (run !== undefined && !saved?.config) throw new Error("Missing frozen run model configuration");
					const config: RuntimeSessionConfig = saved?.config
						? JSON.parse(saved.config)
						: await runtime.sessionConfig(session);
					const models = await runtime.modelsFor(config);
					await runtime.harness.commit(async (tx) => {
						(await tx.doc(ModelBindingDoc, target.conversationId, key, null)).config = JSON.stringify(config);
					}, context);
					return models;
				},
				registry: runtime.registry,
				settings: {
					steeringMode: "all",
					followUpMode: "all",
					retry: retryPolicy(options.config.retry),
					...(modelTimeouts(options.config.timeouts).totalMs
						? { stream: { timeoutMs: modelTimeouts(options.config.timeouts).totalMs } }
						: {}),
					...(options.config.compaction ? { compaction: options.config.compaction } : {}),
				},
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
		await runtime.health.load();
		await runtime.quota.load();
		runtime.watch.start();
		return runtime;
	}
	/** A run owns independent provider factories and catalog caches; selection never mutates a global Models. */
	private modelsFor(config: RuntimeSessionConfig): Promise<Models> {
		let pending = this.boundModels.get(config);
		if (!pending) {
			pending = (async () => {
				const selection = Object.freeze({ ...config.resolved.credentialSlots });
				const aliases = fallbackAliases(config.resolved.fallback, selection, config.resolved.model);
				config.credentialGenerations ??= await this.credentialSlots.capture(selection, aliases);
				const credentials = this.credentialSlots.bind(selection, config.credentialGenerations, aliases);
				const models = buildModels(
					credentials,
					this.options.config.models?.providers,
					selection,
					aliases,
					{
						onProviderEvent: (provider, data) => {
							const alias = parseAccountProvider(provider);
							const account = alias
								? accountKey(alias.provider, alias.slot)
								: accountKey(provider, selection[provider] ?? "default");
							this.quota.record(account, data);
						},
					},
					{ firstTokenMs: modelTimeouts(this.options.config.timeouts).firstTokenMs },
				);
				for (const [provider, slot] of Object.entries(selection)) {
					if (!models.getProvider(provider)) throw new Error(`Unknown model provider: ${provider}`);
					if (slot !== "default") await credentials.read(provider);
				}
				for (const alias of Object.keys(aliases)) await credentials.read(alias);
				return models;
			})();
			this.boundModels.set(config, pending);
		}
		return pending;
	}
	private environment(config: RuntimeSessionConfig): ExecutionEnv {
		if (config.resolved.env === "local") return localEnvironment(config.cwd);
		const env = this.options.envs?.get(config.resolved.env);
		if (!env) throw new Error(`Unknown execution environment: ${config.resolved.env}`);
		return env;
	}
	private async context(id: string, context: Context): Promise<ToolContext> {
		const saved = this.invocationConfigs.get(context);
		const config = saved?.config ?? this.currentConfig(id) ?? (await this.options.resolveSession(id));
		const live = await this.harness.snapshot(LiveDoc, cid(id), C);
		const events = saved?.events ?? (await this.sources(live?.run?.inputs ?? []));
		const input = events[0];
		return {
			agent: config.agent,
			profile: config.profile,
			session: id,
			capabilities: [...config.resolved.capabilities],
			...(config.resolved.channelInstances === undefined
				? {}
				: { channelInstances: [...config.resolved.channelInstances] }),
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
		await this.restartNotes;
		const live = await this.harness.snapshot(LiveDoc, cid(session), context);
		if (!live?.run) return;
		const id = String(live.run.inputs[0]);
		const active = this.limits.states.get(id);
		if (active) {
			if (!this.restoring) await this.preparePlacedInputs(session, active.config, active.started, context);
			return;
		}
		const saved = await this.harness.snapshot(RunDoc, cid(session), id, context);
		// beforeAgent is actual execution, unlike admission into the inbox. Also runs
		// for a genuinely live recovered run, never for a historical receipt.
		await this.harness.commit(async (tx) => {
			const activity = await tx.doc(SessionDoc, cid(session));
			activity.activityRunId = id;
			activity.activityIssue = null;
		}, context);
		const started = saved?.started || Date.now();
		const config: RuntimeSessionConfig = saved?.config
			? JSON.parse(saved.config)
			: structuredClone(await this.options.resolveSession(session));
		const usageBefore = saved?.config ? saved.usageBefore : await this.usage(session);
		if (!saved?.config) await this.applyRequestedEffort(session, config, context);
		await this.modelsFor(config);
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
			visibility: new AbortController(),
			id,
			session,
			config,
			started,
			warnings: new Set(saved?.warnings ?? []),
			usageBefore,
			toolTasks: [...(saved?.toolTasks ?? [])],
			turns: saved?.turns ?? 0,
			repeats: saved?.repeats ?? 0,
			...(saved?.previous ? { previous: JSON.parse(saved.previous) } : {}),
			...(saved?.reason ? { reason: saved.reason } : {}),
			...(saved?.error ? { error: saved.error } : {}),
			timer: undefined,
			deadline: started + config.resolved.limits.maxMinutes * 60000,
		};
		if (!this.restoring) this.limits.arm(state);
		this.limits.states.set(id, state);
		if (!this.restoring) await this.preparePlacedInputs(session, config, started, context);
	}
	/** Per-run effort from authorized delegations; changes only this run's snapshot, never the profile or session. */
	private async applyRequestedEffort(session: string, config: RuntimeSessionConfig, context: Context): Promise<void> {
		const view = await (await this.conversation(session)).context(context);
		const prepared = new Set(
			view.entries
				.filter((entry) => entry.kind === "yonder.prepared")
				.map((entry) => (entry.data as { target: number }).target),
		);
		const events: YEvent[] = [];
		for (const entry of view.entries) {
			const data = entry.data as { raw?: boolean; event?: string } | undefined;
			if (entry.kind !== "yonder.message" || !data?.raw || !data.event || prepared.has(entry.id)) continue;
			const event = await this.options.readEvent?.(data.event);
			if (event) events.push(event);
		}
		const overrides = events
			.filter(
				(event) =>
					event.type === "session.input" &&
					event.from?.startsWith("agent:") &&
					(event.data as { taskOwned?: boolean }).taskOwned === true,
			)
			.map((event) => (event.data as { credentialSlots?: Record<string, string> }).credentialSlots)
			.filter((value) => value !== undefined);
		for (const override of overrides) {
			if (!override || typeof override !== "object" || Array.isArray(override))
				throw new Error("Invalid credential slot override");
			for (const [provider, slot] of Object.entries(override)) {
				validateSlotPart(provider);
				validateSlotPart(slot);
			}
		}
		config.resolved.credentialSlots = mergeCredentialSlots(config.resolved.credentialSlots, ...overrides);
		const asked = requestedEffort(events);
		if (!asked) return;
		const slash = config.resolved.model.indexOf("/");
		const model = (await this.modelsFor(config)).getModel(
			config.resolved.model.slice(0, slash),
			config.resolved.model.slice(slash + 1),
		);
		try {
			if (!model) throw new Error("Unknown model");
			const resolution = resolveEffort(model, config.resolved.thinking as ModelThinkingLevel, asked.requested, true);
			config.resolved = { ...config.resolved, thinking: resolution.effective };
			config.effort = {
				requested: asked.requested,
				effective: resolution.effective,
				...(resolution.fallbackReason ? { reason: resolution.fallbackReason } : {}),
				inputs: asked.inputs,
			};
		} catch {
			config.effort = {
				requested: asked.requested,
				effective: config.resolved.thinking,
				reason: "model-without-effort",
				inputs: asked.inputs,
			};
		}
	}
	private install() {
		this.background = createBackground({
			harness: () => this.harness,
			config: async (session, context) => {
				const ctx = await this.context(session, context);
				return JSON.stringify({
					config: this.currentConfig(session) ?? (await this.options.resolveSession(session)),
					events: ctx.events ?? [],
				});
			},
			execute: async (input, api, context) => {
				const snapshot = JSON.parse(input.config);
				this.invocationConfigs.set(context, snapshot);
				try {
					const tool = this.rawTools.get(input.name);
					if (!tool) throw new Error(`Unavailable tool: ${input.name}`);
					let result: ReturnType<typeof toResult>;
					try {
						result = await tool.execute(input.args, { ...api, env: this.environment(snapshot.config) }, context);
					} catch (error) {
						result = toResult({ text: error instanceof Error ? error.message : String(error), isError: true });
					}
					const ctx = await this.context(String(api.conversationId), context);
					for (const plugin of this.options.plugins ?? [])
						if (snapshot.config.resolved.plugins.includes(plugin.id))
							for (const hook of plugin.hooks) {
								const changed = await hook.afterTool?.(
									{ id: api.callId, name: input.name, args: input.args },
									fromResult(result),
									ctx,
								);
								if (changed) result = toResult(changed.result);
							}
					return result;
				} finally {
					this.invocationConfigs.delete(context);
				}
			},
			finished: async (session, id, name, value, origin) => {
				await this.options.onBackground?.(session, {
					id,
					name,
					result: fromResult(value),
					...(origin ? { origin } : {}),
				});
			},
			report: (error) => this.options.onReport?.(error),
			settled: (session) => this.idleChanged(session),
		});
		this.registry.install(this.background.extension);
		this.extensions.set(this.background.extension.name, this.background.extension);

		// One pi section per prompt part, so a changed part patches only itself and the cached prefix survives.
		// Parts without a declared key, or out of declared order, keep the legacy single "yonder" block.
		const keys = ["yonder", ...(this.options.sectionKeys ?? []).filter((key) => key !== "yonder")];
		// All sections of one render pass share the same input object; render the parts once per pass.
		const passes = new WeakMap<object, Promise<Map<string, string>>>();
		const parts = (input: PromptInput<ToolRegistration>, context: Context) => {
			let pass = passes.get(input);
			if (!pass) {
				pass = (async () => {
					await input.read.snapshot(SessionDoc, input.conversationId, context);
					const config = this.currentConfig(String(input.conversationId));
					if (!config) throw new Error("Missing active configuration");
					const rendered =
						(await this.options.sections?.({ ...config, id: String(input.conversationId) }, context.abortSignal)) ?? [];
					return promptParts(rendered, keys);
				})();
				passes.set(input, pass);
			}
			return pass;
		};
		const core = defineExtension({
			name: "yonder.core",
			sections: keys.map((key) =>
				section(key, async (input, context) => (await parts(input, context)).get(key), { tag: false }),
			),
			hooks: [
				...this.limits.hooks(),
				...recoveryHooks(() => this.harness, retryPolicy(this.options.config.retry).maxRetries),
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
			tools: [
				...(codingTools.tools ?? []).filter((t) => t.name !== "bash"),
				processTool(this.options.home, this.background.running),
			].map((t) => this.backgroundTool({ ...t, deferred: true })),
		});
		this.registry.install(coding);
		this.extensions.set(coding.name, coding);
		const search = createToolSearchExtension();
		this.registry.install(search);
		this.extensions.set(search.name, search);
		for (const extension of [coding, search]) for (const tool of extension.tools ?? []) this.tools.set(tool.name, tool);
		const todo = defineTool({
			name: "todo",
			description: todoDescription,
			parameters: todoParameters,
			execute: async (args, api, context) => {
				const outcome = await api.commit(async (tx) => {
					const doc = await tx.doc(SessionDoc, api.conversationId);
					// SAFETY: pi-durable validated args against todoParameters, which TodoArgs mirrors.
					const result = applyTodo(doc.todos ?? emptyTodos(), args as unknown as TodoArgs);
					if (result.list) doc.todos = result.list;
					return result;
				}, context);
				if (outcome.list) await this.options.onTodo?.(todoEvent(String(api.conversationId), outcome.list));
				return { output: [{ type: "text", text: outcome.text }] };
			},
		});
		const todos = defineExtension({ name: "yonder.todo", tools: [todo] });
		this.capabilities.set("todo", []);
		this.registry.install(todos);
		this.extensions.set(todos.name, todos);
		this.tools.set("todo", todo);
		const processes = defineExtension({ name: "yonder.process", tools: [this.background.tool] });
		this.capabilities.set("process", []);
		this.registry.install(processes);
		this.extensions.set(processes.name, processes);
		this.tools.set("process", this.background.tool);
		const builtins = this.adapter("yonder.tools", [createGrepTool(), ...(this.options.tools ?? [])], []);
		this.registry.install(builtins);
		this.extensions.set(builtins.name, builtins);
		for (const plugin of this.options.plugins ?? []) {
			const extension = this.adapter(`plugin:${plugin.id}`, plugin.tools, plugin.hooks);
			this.registry.install(extension);
			this.extensions.set(extension.name, extension);
		}
	}
	private backgroundTool(tool: ToolRegistration): ToolRegistration {
		this.rawTools.set(tool.name, tool);
		const registration = {
			...tool,
			...(tool.structuredOutputSchema
				? {
						structuredOutputSchema: Type.Union([
							tool.structuredOutputSchema,
							Type.Object({ background: Type.String() }),
						]),
					}
				: {}),
		};
		return {
			...registration,
			execute: (args, api, context) => this.background.run(tool, args as JsonObject, api, context),
		};
	}
	private adapter(name: string, tools: Tool[], hooks: Hook[]): Extension {
		const registrations = tools.map((tool) => {
			this.capabilities.set(tool.name, tool.capabilities);
			const registration = this.backgroundTool(
				defineTool({
					name: tool.name,
					description: tool.description,
					parameters: tool.parameters,
					deferred: true,
					...(["task_run", "agent_ask", "parent_ask", "task_continue"].includes(tool.name)
						? { replay: "safe" as const }
						: {}),
					execute: async (args, api, context) => {
						const ctx = await this.context(String(api.conversationId), context);
						this.toolInvocations.set(ctx, { api, context });
						try {
							return toResult(await tool.execute(args, ctx));
						} finally {
							this.toolInvocations.delete(ctx);
						}
					},
				}),
			);
			this.tools.set(tool.name, registration);
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
							await this.context(String(api.conversationId), context),
						);
						return changed ? toResult(changed.result) : undefined;
					},
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
				}),
				hook(GenerationTask, {
					beforeRequest: async (request, api, context) =>
						plugin.beforeRequest?.([...request.messages], await this.context(String(api.conversationId), context)),
				}),
			]),
		});
	}
	/** Shared services may only act with the exact context of an active native tool invocation. */
	assertToolContext(ctx: ToolContext): void {
		if (!this.toolInvocations.has(ctx)) throw new Error("需要真实运行中的工具调用上下文。");
		ctx.signal.throwIfAborted();
	}
	async authorizeAttachments(ctx: ToolContext, attachments: Attachment[] = []): Promise<void> {
		const invocation = this.toolInvocations.get(ctx);
		if (!invocation) throw new Error("需要真实运行中的工具调用上下文。");
		ctx.signal.throwIfAborted();
		if (!attachments.length) return;
		const config = this.currentConfig(ctx.session);
		if (!config) throw new Error("当前运行配置不存在。");
		if (ctx.env.id !== "node:local") throw new Error("渠道附件暂不支持远程执行环境。");
		for (const attachment of attachments) {
			if (!attachment.uri.startsWith("file:")) throw new Error("发送附件必须是可验证的本地文件 URI。");
			const path = fileURLToPath(attachment.uri);
			const denied = await this.policy.denied("read", { path }, config, invocation.context, ctx.session);
			if (denied) throw new Error(denied);
			getOrThrow(await ctx.env.canonicalPath(path, invocation.context));
		}
	}

	async create(meta: {
		agent: string | null;
		profile: string;
		cwd: string;
		env?: string;
		capabilities?: Capability[];
		channelInstances?: string[];
		inherit?: RuntimeSessionState["inherit"];
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
						channelInstances: meta.channelInstances ?? null,
						inherit: meta.inherit ?? null,
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
			...(state.models ? { models: structuredClone(state.models) } : {}),
			agent: state.agent,
			profile: state.profile,
			close: state.close ?? "run-end",
			cwd: state.cwd,
			env: state.env,
			...(state.capabilities ? { capabilities: [...state.capabilities] } : {}),
			...(state.channelInstances ? { channelInstances: [...state.channelInstances] } : {}),
			...(state.inherit ? { inherit: structuredClone(state.inherit) } : {}),
		};
	}
	async setSessionState(id: string, state: RuntimeSessionState): Promise<void> {
		await (await this.conversation(id)).commit(async (tx) => {
			Object.assign(await tx.doc(SessionDoc, cid(id)), {
				...state,
				capabilities: state.capabilities ?? null,
				channelInstances: state.channelInstances ?? null,
				inherit: state.inherit ?? null,
			});
		}, C);
		this.configured.delete(id);
	}
	describeTools(config: RuntimeSessionConfig) {
		return describeCatalog(
			config,
			[...this.tools.values()].map((tool) => {
				const extension = [...this.extensions.values()].find((item) => item.tools?.includes(tool));
				return {
					name: tool.name,
					capabilities: this.capabilities.get(tool.name) ?? [],
					...(extension?.name.startsWith("plugin:") ? { plugin: extension.name.slice(7) } : {}),
				};
			}),
		);
	}
	async configure(id: string): Promise<void> {
		if ((await this.harness.snapshot(LiveDoc, cid(id), C))?.run) return;
		await this.applyConfiguration(id, await this.options.resolveSession(id));
	}
	private async applyConfiguration(id: string, config: RuntimeSessionConfig): Promise<void> {
		const profile = config.resolved;
		const selected = [
			"yonder.core",
			"yonder.files",
			"yonder.tools",
			"yonder.background",
			"yonder.todo",
			"yonder.process",
			...profile.plugins.map((id) => `plugin:${id}`),
		];
		const exposure = this.describeTools(config);
		const offered = exposure.filter((tool) => tool.exposure === "offer").map((tool) => this.tools.get(tool.name)!);
		const deferred = exposure.filter((tool) => tool.exposure === "search").map((tool) => this.tools.get(tool.name)!);
		if (deferred.length) {
			const search = [...this.extensions.values()].find((extension) =>
				extension.tools?.some((tool) => tool.name === "tool_search"),
			);
			if (search) selected.push(search.name);
		}
		const tools = [...new Set([...offered, ...deferred])];
		const conversation = await this.conversation(id);
		this.pollQuota(profile.fallback, profile.credentialSlots);
		// Held or over-quota entries are not a starting model: they move to the back of the chain.
		const chain = this.watch.order(
			modelChain(profile.model, profile.fallback, profile.credentialSlots),
			profile.fallback?.quotaStopPercent,
		);
		const primary = chain[0] ?? splitModelRef(profile.model);
		const model = { provider: primary.provider, modelId: primary.modelId };
		const alternatives = chain.slice(1);
		const modelFallbacks = alternatives.length
			? {
					models: alternatives.map((entry) => ({ provider: entry.provider, modelId: entry.modelId })),
					after: profile.fallback?.after ?? DEFAULT_FALLBACK_AFTER,
				}
			: null;
		const current = await this.harness.snapshot(AgentDoc, cid(id), C);
		const same =
			current &&
			JSON.stringify(current.model) === JSON.stringify(model) &&
			JSON.stringify(current.modelFallbacks ?? null) === JSON.stringify(modelFallbacks) &&
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
					modelFallbacks,
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
	async configureModels(id: string, models: SessionModels | null): Promise<void> {
		await (await this.conversation(id)).commit(async (tx) => {
			(await tx.doc(SessionDoc, cid(id))).models = models;
		}, C);
		await this.configure(id);
	}
	async modelStatus(id: string) {
		await this.configure(id);
		const conversation = await this.conversation(id);
		const agent = await conversation.agent(C);
		const config = await this.sessionConfig(id);
		const ref = agent.model;
		const model = ref ? (await this.modelsFor(config)).getModel(ref.provider, ref.modelId) : undefined;
		const view = await conversation.context(C);
		const live = await this.harness.snapshot(LiveDoc, cid(id), C);
		const policy = { ...DEFAULT_COMPACTION_POLICY, ...this.options.config.compaction };
		const compactable = selectCut(view, policy.keepRecentTokens) !== undefined;
		const graph = await this.harness.taskGraph(C);
		try {
			const all = Object.values(graph.value.tasks);
			const scope = new Set([Number(id)]);
			for (let changed = true; changed; ) {
				changed = false;
				for (const task of all)
					if (scope.has(task.conversationId))
						for (const child of task.conversations)
							if (!scope.has(child)) {
								scope.add(child);
								changed = true;
							}
			}
			return {
				model: model
					? { provider: model.provider, id: model.id, contextWindow: model.contextWindow, maxTokens: model.maxTokens }
					: null,
				thinking: agent.thinkingLevel,
				primary: config.resolved.model,
				fallback: config.resolved.fallback,
				failures: live?.run?.modelFallback?.failures ?? 0,
				running: !!live?.run,
				contextTokens: estimateContext(view, []),
				compact: {
					available: !live?.compactions?.length && compactable,
					reason: live?.compactions?.length ? "压缩进行中" : !compactable ? "尚无可压缩的较早上下文" : "可压缩",
					tasks: (live?.compactions ?? []).map((task) => String(task.taskId)),
					failure: live?.compactionFailure?.error,
				},
				tasks: await Promise.all(
					all
						.filter((task) => scope.has(task.conversationId))
						.map(async (task) => {
							const record = await this.harness.getTask(task.id, C);
							const conversation = await this.harness.conversation(task.conversationId, C);
							const native = await conversation?.agent(C);
							const checkpoint =
								record && record.state.status !== "terminal"
									? (record.state.checkpoint as {
											model?: { provider: string; modelId: string };
											thinkingLevel?: string;
										})
									: undefined;
							const selected = checkpoint?.model ?? native?.model;
							const input = record?.input as { name?: string; args?: { agent?: string } } | undefined;
							return {
								name: input?.name,
								model: selected ? `${selected.provider}/${selected.modelId}` : undefined,
								thinking: checkpoint?.thinkingLevel ?? native?.thinkingLevel,
								targetAgent: input?.name === "agent_ask" ? input.args?.agent : undefined,
								id: String(task.id),
								session: String(task.conversationId),
								kind: task.kind,
								owner: task.owner ? String(task.owner) : undefined,
								background: task.background,
								state: task.state.status,
							};
						}),
				),
			};
		} finally {
			graph.dispose();
		}
	}
	async compact(id: string, instructions?: string): Promise<string> {
		const status = await this.modelStatus(id);
		if (!status.compact.available) throw new Error(status.compact.reason);
		return String(await (await this.conversation(id)).compact(instructions, C));
	}
	private async conversation(id: string) {
		const value = await this.harness.conversation(cid(id), C);
		if (!value) throw new Error(`Unknown conversation: ${id}`);
		return value;
	}
	private async inputContent(
		config: RuntimeSessionConfig,
		input: RuntimeInput,
		preparation: Context,
		remainingImages = Infinity,
		remainingBytes = Infinity,
	) {
		const env = this.environment(config);
		const content: Array<{ type: "text"; text: string } | { type: "image"; mimeType: string; data: string }> = [
			{ type: "text", text: input.text },
		];
		const model = (await this.modelsFor(config)).getModel(
			config.resolved.model.slice(0, config.resolved.model.indexOf("/")),
			config.resolved.model.slice(config.resolved.model.indexOf("/") + 1),
		);
		let count = 0;
		const actual = new Map<string, { mime: string; bytes: number }>();
		for (const attachment of input.attachments ?? [])
			if (attachment.kind === "image") {
				const bytes = attachment.uri.startsWith("data:")
					? Buffer.from(imageData(attachment.uri), "base64")
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
					mime &&
					model?.input.includes("image") &&
					count < Math.min(remainingImages, model.inputLimits?.images?.maxPerMessage ?? Infinity)
						? await (await this.imageProcessor()).prepare(bytes, mime, {
								maxWidth: resize?.maxWidth ?? DEFAULT_IMAGE_LIMITS.maxWidth,
								maxHeight: resize?.maxHeight ?? DEFAULT_IMAGE_LIMITS.maxHeight,
								maxBytes: resize?.maxBytes ?? DEFAULT_IMAGE_LIMITS.maxBytes,
							})
						: undefined;
				preparation.abortSignal?.throwIfAborted();
				if (
					image &&
					Buffer.byteLength(JSON.stringify(content)) + Buffer.byteLength(image.data) + 128 <= remainingBytes
				) {
					content.push({ type: "image", mimeType: image.mimeType, data: image.data });
					count++;
				} else
					content.push({
						type: "text",
						text: `attachment: ${attachment.name ?? attachment.kind} ${attachment.uri} (${mime ?? attachment.mime}, ${bytes.byteLength} bytes); image could not be supplied within this model's input limits`,
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
	private async preparePlacedInputs(
		session: string,
		config: RuntimeSessionConfig,
		started: number,
		context: Context,
	): Promise<void> {
		const conversation = await this.conversation(session);
		let view = await conversation.context(context);
		const prepared = new Set(
			view.entries
				.filter((entry) => entry.kind === "yonder.prepared")
				.map((entry) => (entry.data as { target: number }).target),
		);
		for (const entry of view.entries) {
			const data = entry.data as
				| { raw?: boolean; event?: string; wake?: "run" | "write"; attachments?: Attachment[] }
				| undefined;
			if (entry.kind !== "yonder.message" || !data?.raw || prepared.has(entry.id)) continue;
			const event = data.event ? await this.options.readEvent?.(data.event) : undefined;
			if (data.event && !event) throw new Error(`Missing input event: ${data.event}`);
			const input =
				event && this.options.prepareInput
					? await this.options.prepareInput(session, event, config, data.wake ?? "run", context.abortSignal)
					: { text: textOf(entry), ...(event ? { event } : {}), attachments: data.attachments ?? [] };
			if (data.wake !== "write") {
				const now = Date.now();
				input.text = `<runtime_clock utc="${new Date(now).toISOString()}">Elapsed ${Math.round((now - started) / 1000)} seconds at input preparation. Time/turn/token thresholds are reminders; explicit cancellation and real provider limits remain effective.</runtime_clock>\n\n${input.text}`;
			}
			const slash = config.resolved.model.indexOf("/");
			const model = (await this.modelsFor(config)).getModel(
				config.resolved.model.slice(0, slash),
				config.resolved.model.slice(slash + 1),
			);
			const images = view.messages.flatMap((message) =>
				Array.isArray(message.content) ? message.content.filter((block) => block.type === "image") : [],
			).length;
			const content = await this.inputContent(
				config,
				input,
				context,
				(model?.inputLimits?.images?.maxPerRequest ?? Infinity) - images,
				(model?.inputLimits?.maxRequestBytes ?? Infinity) - Buffer.byteLength(JSON.stringify(view.messages)),
			);
			await this.harness.commit(async (tx) => {
				await tx.appendEntry(cid(session), {
					kind: "yonder.prepared",
					data: JSON.parse(
						JSON.stringify({
							target: entry.id,
							event: data.event,
							attachments:
								(input.event?.data as { attachments?: Attachment[] } | undefined)?.attachments ??
								input.attachments ??
								[],
						}),
					),
					edits: [
						{ target: entry.id, action: "replace", messages: [{ role: "user", content, timestamp: Date.now() }] },
					],
				});
			}, context);
			await this.options.onAdmitted?.(session, input);
			view = await conversation.context(context);
		}
	}
	private inputEntry(input: RuntimeInput) {
		return {
			kind: "yonder.message",
			data: JSON.parse(
				JSON.stringify({
					raw: true,
					event: input.event?.id,
					wake: input.wake ?? "run",
					attachments: input.attachments ?? [],
				}),
			) as JsonObject,
		};
	}
	async notify(id: string, input: { from: string; event: string; text: string }) {
		return writeNotification(await this.conversation(id), input);
	}
	async submit(id: string, input: RuntimeInput, accepted?: () => void): Promise<RuntimeRun> {
		const conversation = await this.conversation(id);
		const requestId = input.requestId ?? (input.event ? `event:${input.event.id}` : undefined);
		const existing = requestId ? await this.storage.submissionByRequest(cid(id), requestId, C) : undefined;
		const content = [{ type: "text" as const, text: input.text }];
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
					projectOutput(event, { ...input, onOutput: (part) => input.onOutput?.(part, outputRun) }, textBlocks);
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
									whenBusy: input.busy === "followup" ? "followUp" : (input.busy ?? "steer"),
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
			accepted?.();
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
	/** Resolve at durable admission; observe the eventual run without holding its caller. */
	async enqueue(id: string, input: RuntimeInput): Promise<void> {
		await new Promise<void>((accept, reject) => {
			void this.submit(id, input, accept).catch((error) => {
				reject(error);
				this.options.onReport?.(error);
			});
		});
	}
	invocationId(ctx: ToolContext): string {
		const invocation = this.toolInvocations.get(ctx);
		if (!invocation) throw new Error("Requires an active runtime tool invocation");
		return `${ctx.session}:${invocation.api.taskId}`;
	}
	private async attachSubmission(
		submission: Submission,
		event: RuntimeInput["event"],
		_session: string,
	): Promise<void> {
		this.submissions.set(String(submission.id), { event });
	}

	async abort(id: string): Promise<void> {
		const [live, activity] = await Promise.all([
			this.harness.snapshot(LiveDoc, cid(id), C),
			this.harness.snapshot(SessionDoc, cid(id), C),
		]);
		const cancelledRun = live?.run ? String(live.run.inputs[0]) : (activity?.activityRunId ?? null);
		await (await this.conversation(id)).abort(C, { background: true });
		await this.harness.commit(async (tx) => {
			const state = await tx.doc(SessionDoc, cid(id));
			// A later input can already have started while cancellation joined its old scope.
			if ((state.activityRunId ?? null) !== cancelledRun) return;
			state.activityIssue = null;
			state.activityRunId = null;
		}, C);
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
		// Push the bounds into the scan so a one-entry read does not decode the whole conversation.
		const page = await (await this.conversation(id)).entries(
			{ order: "ascending", ...(range.from === undefined ? {} : { minEntryId: range.from as EntryId }) },
			range.limit ?? 100,
			undefined,
			C,
		);
		return page.items.map(transcriptItem);
	}
	/**
	 * Track one fallback episode per session and report its edges (contracts §3.3): the first answered run on a
	 * non-primary model starts it, the first answered run on the primary ends it. Runs without an answer say
	 * nothing about which model works, so they change nothing.
	 */
	private async noteFallback(session: string, config: RuntimeSessionConfig, run: RuntimeRun, from?: number) {
		if (!run.model || run.status !== "done" || !this.options.onModelFallback) return;
		const primary = splitModelRef(config.resolved.model);
		const primaryRef = { provider: primary.provider, model: primary.modelId };
		const slash = run.model.indexOf("/");
		const actual = { provider: run.model.slice(0, slash), model: run.model.slice(slash + 1) };
		const onPrimary = actual.provider === primaryRef.provider && actual.model === primaryRef.model;
		const episode = (await this.harness.snapshot(SessionDoc, cid(session), C))?.fallback ?? null;
		if (onPrimary === !episode) return;
		let reason = episode?.reason ?? "error";
		if (!episode) {
			const entries = await this.storage.scanEntries(
				{ conversationId: cid(session), ...(from === undefined ? {} : { minEntryId: from as EntryId }) },
				Number.MAX_SAFE_INTEGER,
				undefined,
				C,
			);
			const attempt = entries.items.findLast(
				(entry) =>
					entry.kind === "pi.model-attempt" && (entry.data as { action?: string } | undefined)?.action === "fallback",
			);
			reason = fallbackReason((attempt?.data as { error?: string } | undefined)?.error);
		}
		await (await this.conversation(session)).commit(async (tx) => {
			(await tx.doc(SessionDoc, cid(session))).fallback = onPrimary ? null : { ...actual, reason };
		}, C);
		await this.options.onModelFallback(
			onPrimary
				? {
						session,
						state: "recovered",
						from: { provider: episode!.provider, model: episode!.model },
						to: primaryRef,
						reason,
					}
				: { session, state: "fallback", from: primaryRef, to: actual, reason },
		);
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
		try {
			const handle = await api.conversation(child, context);
			if (!handle) throw new Error("Child conversation is missing");
			// Invocation-bound submit preserves pi task ownership and idempotent task request IDs.
			const submission = await handle.submit(
				{
					type: "input",
					content: [{ type: "text", text: input.text }],
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
			// Observe the admitted child outside the parent invocation; native ownership still cancels it.
			const admitted = await this.harness.submission(submission.id, C);
			if (!admitted) throw new Error("Admitted child input is missing");
			const done = await admitted.wait(C);
			await this.settledRun(String(child), done);
			while (true) {
				let changed!: () => void;
				const next = new Promise<void>((resolve) => {
					changed = resolve;
				});
				const waiters = this.idleWaiters.get(String(child)) ?? new Set();
				waiters.add(changed);
				this.idleWaiters.set(String(child), waiters);
				context.abortSignal?.addEventListener("abort", changed, { once: true });
				try {
					context.abortSignal?.throwIfAborted();
					if (!(await this.hasPendingWork(String(child)))) break;
					await next;
					context.abortSignal?.throwIfAborted();
				} finally {
					context.abortSignal?.removeEventListener("abort", changed);
					waiters.delete(changed);
					if (!waiters.size) this.idleWaiters.delete(String(child));
				}
			}
			const last = await this.lastResult(String(child));
			if (!last) throw new Error("Child task has no terminal receipt");
			const receipt = await this.harness.snapshot(RunReceiptDoc, child, last.runId, C);
			const result = await this.receiptRun(String(child), last.runId, receipt!);
			return { ...result, text: taskReport(result.text) };
		} catch (error) {
			if (input.event && !(await this.admitted(String(child), input.event.id)))
				await this.options.onRun?.(String(child), {
					runId: `error:${input.event.id}`,
					session: String(child),
					status: "error",
					text: "",
					reason: error instanceof Error ? error.message : String(error),
					usage: emptyUsage(),
					inputs: [input.event.id],
				});
			throw error;
		}
	}
	private async sources(ids: readonly number[]): Promise<import("@yonder/sdk").YEvent[]> {
		const events: import("@yonder/sdk").YEvent[] = [];
		for (const id of ids) {
			const record = await this.storage.submission(id as import("@earendil-works/pi-durable").SubmissionId, C);
			const entry = record?.entry ? await this.harness.commit((tx) => tx.entry(record.entry!), C) : undefined;
			let data = entry?.data as { event?: string; attachments?: import("@yonder/sdk").Attachment[] } | undefined;
			if (entry) {
				// The prepared entry that targets an input is written before that input is answered, so an answered
				// input never needs the rest of the conversation. Unbounded, this was measurable: recover() visits every
				// historical run and startup grew to about two minutes for a few dozen runs of one long conversation.
				const history = await this.storage.scanEntries(
					{
						conversationId: entry.conversationId,
						minEntryId: entry.id,
						...(record?.status === "done" ? { maxEntryId: record.answer } : {}),
					},
					Number.MAX_SAFE_INTEGER,
					undefined,
					C,
				);
				const prepared = history.items.find(
					(item) => item.kind === "yonder.prepared" && (item.data as { target?: number })?.target === entry.id,
				);
				if (prepared) data = prepared.data as typeof data;
			}
			const event =
				(data?.event ? await this.options.readEvent?.(data.event) : undefined) ??
				this.submissions.get(String(id))?.event;
			if (data?.event && !event) throw new Error(`submission ${id} 的来源事件 ${data.event} 不可恢复`);
			if (event)
				events.push(data?.attachments ? { ...event, data: { ...event.data, attachments: data.attachments } } : event);
		}
		return events;
	}
	private async receiptRun(session: string, key: string, receipt: Readonly<RunReceiptState>): Promise<RuntimeRun> {
		const finishKey = `${session}\0${key}`;
		const existing = this.finishing.get(finishKey);
		if (existing) return existing;
		const promise = (async () => {
			const saved = await this.harness.snapshot(RunDoc, cid(session), key, C);
			await this.settleActivity(session, key, receipt, {
				error: saved?.error ?? null,
				reason: saved?.reason ?? null,
			});
			if (!saved?.config || !receipt.settlement)
				throw new Error(`运行 ${session}/${key} 缺少开始配置或终结凭据，历史结果不可确定`);
			const config: RuntimeSessionConfig = JSON.parse(saved.config);
			const usage = sumUsage(receipt.usage);
			for (const field of Object.keys(usage) as Array<keyof typeof usage>) usage[field] -= saved.usageBefore[field];
			const settlement = receipt.settlement;
			const answer =
				settlement.status === "done" ? await this.harness.commit((tx) => tx.entry(settlement.answer), C) : undefined;
			const inputs = (await this.sources(receipt.inputs)).map((event) => event.id);
			// Tool results of this run lie between its first input entry and its answer entry. recover() settles every
			// historical receipt, so reading the whole conversation here made startup grow with runs x entries
			// (about two minutes for a few dozen runs of a long conversation).
			const placed = (await Promise.all(receipt.inputs.map((input) => this.storage.submission(input, C))))
				.map((record) => record?.entry)
				.filter((entry): entry is NonNullable<typeof entry> => entry !== undefined);
			const entries = (saved.toolTasks ?? []).length
				? await this.storage.scanEntries(
						{
							conversationId: cid(session),
							...(placed.length ? { minEntryId: Math.min(...placed) as (typeof placed)[number] } : {}),
							...(settlement.status === "done" ? { maxEntryId: settlement.answer } : {}),
						},
						Number.MAX_SAFE_INTEGER,
						undefined,
						C,
					)
				: { items: [] };
			const attachments = entries.items.flatMap((entry) =>
				(entry.model ?? []).flatMap((message) =>
					message.role === "toolResult" &&
					entry.byTaskId !== undefined &&
					(saved.toolTasks ?? []).includes(entry.byTaskId)
						? ((message.details as { attachments?: Attachment[] } | undefined)?.attachments ?? [])
						: [],
				),
			);
			const run: RuntimeRun = {
				runId: key,
				session,
				...(attachments.length ? { attachments } : {}),
				config,
				...(answer?.model?.[0]?.role === "assistant"
					? { model: `${answer.model[0].provider}/${answer.model[0].model}` }
					: {}),
				...(saved.error
					? { status: "error" as const, reason: saved.error }
					: submissionOutcome(settlement, saved.reason ?? undefined)),
				text: textOf(answer),
				...(answer?.model?.[0]?.role === "assistant" ? { message: String(answer.model[0].timestamp) } : {}),
				inputs,
				usage,
			};
			await this.watch.record(config, run, await this.watch.chainIndex(session, config, run));
			await this.noteFallback(session, config, run, placed.length ? Math.min(...placed) : undefined);
			const active = this.limits.states.get(key);
			active?.visibility.abort();
			clearTimeout(active?.timer);
			try {
				await this.options.onRun?.(session, run);
				await this.idleChanged(session);
			} finally {
				const state = this.limits.states.get(key);
				if (state) {
					state.visibility.abort();
					clearTimeout(state.timer);
					this.limits.states.delete(key);
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
	/** The existing receipt observer projects only the run actually started by this core. */
	private async settleActivity(
		session: string,
		runId: string,
		receipt: Readonly<RunReceiptState>,
		saved: { error: string | null; reason: string | null },
	): Promise<void> {
		const end = receipt.settlement;
		if (!end) return;
		// Native continuation remains executable work, not a terminal blocker.
		const pending = await this.hasPendingWork(session);
		await this.harness.commit(async (tx) => {
			const state = await tx.doc(SessionDoc, cid(session));
			if (state.activityRunId !== runId) return;
			if (end.status === "done" || (!saved.error && !saved.reason && end.reason === "aborted")) {
				state.activityIssue = null;
				return;
			}
			if (pending || end.status !== "unanswered" || end.reason === "reset") return;
			const code = saved.error
				? "execution_error"
				: saved.reason
					? "runtime_limit"
					: ["model_error", "no_model", "faulted", "orphaned"].includes(end.reason)
						? end.reason
						: "execution_failed";
			state.activityIssue ??= { code, since: Date.now(), runId };
		}, C);
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
			let skipped = false;
			for (const doc of docs.items) {
				const receipt = await this.harness.snapshot(RunReceiptDoc, conversation.id, doc.key!, C);
				for (const input of receipt?.inputs ?? []) covered.add(input);
				if (receipt) {
					// A run whose run.end is durable was fully settled before this start. Replaying every historical run
					// made startup grow with runs x conversation size (about two minutes for Jarvis' main session).
					if (await this.options.settled?.(String(conversation.id), doc.key!)) {
						skipped = true;
						continue;
					}
					try {
						await this.receiptRun(String(conversation.id), doc.key!, receipt);
					} catch (error) {
						this.options.onReport?.(error);
					}
				}
			}
			// Settled runs skipped their idle hook; let waiters and sessions re-evaluate once per conversation.
			if (skipped) await this.idleChanged(String(conversation.id)).catch((error) => this.options.onReport?.(error));
			const live = await this.harness.snapshot(LiveDoc, conversation.id, C);
			if (live?.run) {
				try {
					await this.prepareRun(String(conversation.id), C);
				} catch (error) {
					// A revoked binding faults only its native task on resume, not unrelated conversations/startup.
					this.options.onReport?.(error);
				}
				this.interrupted.push({ session: String(conversation.id), run: String(live.run.inputs[0]) });
			}
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
		for (const state of this.limits.states.values()) if (!state.timer) this.limits.arm(state);
		// Admit notes before a recovered request can pass beforeAgent, including
		// requests whose checkpoint is already in the request phase.
		this.restartNotes = Promise.all(
			this.interrupted.splice(0).map(({ session, run }) =>
				(async () => {
					const state = await this.harness.snapshot(RunDoc, cid(session), run, C);
					if (state?.networkInterrupted) return;
					await this.writeNote(session, `restart:${run}`, RESTART_NOTICE);
					await this.harness.commit(async (tx) => {
						(await tx.doc(RunDoc, cid(session), run, null)).networkInterrupted = true;
					}, C);
				})().catch((error) => this.options.onReport?.(error)),
			),
		).then(() => {});
		for (const item of this.recovering.splice(0)) {
			void (async () => {
				const submission = await this.harness.submission(item.id, C);
				if (submission) await this.settledRun(item.session, await submission.wait(C));
			})().catch(this.options.onReport ?? (() => {}));
		}
		void this.storage
			.scanTasks({ kind: "yonder.background" }, Number.MAX_SAFE_INTEGER, undefined, C)
			.then((page) => this.background.recover(page.items))
			.catch((error) => this.options.onReport?.(error));

		this.harness.resume();
	}
	private async idleChanged(session: string): Promise<void> {
		for (const changed of this.idleWaiters.get(session) ?? []) changed();
		await this.options.onIdle?.(session);
	}

	private async causedBy(source: import("@yonder/sdk").YEvent | undefined, input: string): Promise<boolean> {
		const seen = new Set<string>();
		while (source && !seen.has(source.id)) {
			if (source.id === input) return true;
			seen.add(source.id);
			source = source.parent ? await this.options.readEvent?.(source.parent) : undefined;
		}
		return false;
	}
	async lastResult(session: string, input?: string) {
		const docs = await this.storage.scanDocuments(
			{ scope: { kind: "conversation", conversationId: cid(session) }, kind: "pi.run-receipt", at: "current" },
			Number.MAX_SAFE_INTEGER,
			undefined,
			C,
		);
		for (const doc of [...docs.items].sort((a, b) => b.id - a.id)) {
			const receipt = await this.harness.snapshot(RunReceiptDoc, cid(session), doc.key!, C);
			if (!receipt?.settlement) continue;
			let matches = input === undefined;
			if (input)
				for (const source of await this.sources(receipt.inputs)) {
					if (await this.causedBy(source, input)) {
						matches = true;
						break;
					}
				}
			if (matches) {
				const state = await this.harness.snapshot(RunDoc, cid(session), doc.key!, C);
				return {
					runId: doc.key!,
					...(state?.error
						? { status: "error" as const, reason: state.error }
						: submissionOutcome(receipt.settlement, state?.reason ?? undefined)),
				};
			}
		}
	}

	async resultText(session: string, runId: string): Promise<string> {
		const receipt = await this.harness.snapshot(RunReceiptDoc, cid(session), runId, C);
		const end = receipt?.settlement;
		return end?.status === "done" ? textOf(await this.harness.commit((tx) => tx.entry(end.answer), C)) : "";
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
		await loginProvider(this.options.home, this.options.config, provider, interaction, { method: type });
	}

	async writeNote(id: string, requestId: string, text: string): Promise<void> {
		await (await this.conversation(id)).submit(
			{
				type: "write",
				requestId,
				entry: {
					kind: "yonder.runtime-note",
					data: { from: "system:yonder", text },
					model: [
						{
							role: "user",
							content: [{ type: "text", text: `<runtime_notice source="system:yonder">${text}</runtime_notice>` }],
							timestamp: Date.now(),
						},
					],
				},
			},
			C,
		);
	}

	async hasBackgroundWork(id: string, except?: number, input?: string): Promise<boolean> {
		const tasks = await this.storage.scanTasks(
			{ conversationId: cid(id), kind: "yonder.background" },
			Number.MAX_SAFE_INTEGER,
			undefined,
			C,
		);
		for (const task of tasks.items) {
			if (task.id === except) continue;
			if (input) {
				const config = (task.input as { config?: string }).config;
				const events = config ? (JSON.parse(config) as { events: import("@yonder/sdk").YEvent[] }).events : [];
				let belongs = false;
				for (const event of events)
					if (await this.causedBy(event, input)) {
						belongs = true;
						break;
					}
				if (!belongs) continue;
			}
			if (task.state.status !== "terminal") return true;
			if (await this.background.pending(task.id)) return true;
		}
		return false;
	}
	async hasOtherBackgroundWork(ctx: ToolContext) {
		const invocation = this.toolInvocations.get(ctx);
		if (!invocation) throw new Error("Requires an active runtime tool invocation");
		return this.hasBackgroundWork(ctx.session, invocation.api.taskId);
	}

	/** Read native state only; waiting for a UI answer is not executable work. */
	async hasAwakeWork(id: string): Promise<boolean> {
		const tasks = await this.storage.scanTasks(
			{ conversationId: cid(id), kind: "yonder.background" },
			Number.MAX_SAFE_INTEGER,
			undefined,
			C,
		);
		const pending = tasks.items.filter((task) => task.state.status !== "terminal");

		if (pending.some((task) => (task.input as { name?: string }).name !== "ui-companion_result")) return true;
		const inbox = await this.harness.snapshot(InboxDoc, cid(id), C);
		if (inbox?.items.some((item) => item.mode !== "write")) return true;
		const live = await this.harness.snapshot(LiveDoc, cid(id), C);
		const slots = live?.tools?.filter((slot) => slot.status !== "done") ?? [];
		return !!live?.run && !(slots.length > 0 && slots.every((slot) => slot.name === "ui-companion_result"));
	}

	/** Owner-local presentation, projected from native live state, never reasoning or tool payloads. */
	async activity(id: string) {
		const [live, inbox, background, activity] = await Promise.all([
			this.harness.snapshot(LiveDoc, cid(id), C),
			this.harness.snapshot(InboxDoc, cid(id), C),
			this.storage.scanTasks(
				{ conversationId: cid(id), kind: "yonder.background" },
				Number.MAX_SAFE_INTEGER,
				undefined,
				C,
			),
			this.harness.snapshot(SessionDoc, cid(id), C),
		]);
		const tools = [...(live?.tools ?? []), ...(live?.nestedTools ?? [])]
			.filter((slot) => slot.status !== "done")
			.map((slot) => slot.name);
		tools.push(
			...background.items
				.filter((task) => task.state.status !== "terminal")
				.map((task) => (task.input as { name: string }).name),
		);
		const queued = inbox?.items.some((item) => item.mode !== "write");
		const busy = !!live?.run || !!queued || tools.length > 0 || !!live?.compactions?.length;
		const waiting =
			busy &&
			!queued &&
			!live?.compactions?.length &&
			tools.length > 0 &&
			tools.every((name) => name === "ui-companion_result");
		const runId = live?.run ? String(live.run.inputs[0]) : undefined;
		const generationRetry = live?.run ? live.generation?.retry?.at : undefined;
		const compactions = live?.compactions ?? [];
		const compactionRetry =
			compactions.length > 0 && compactions.every((task) => task.retry)
				? Math.min(...compactions.map((task) => task.retry?.at ?? Infinity))
				: undefined;
		const retryAt = generationRetry ?? compactionRetry;
		const retrying =
			retryAt !== undefined &&
			tools.length === 0 &&
			(!live?.run || generationRetry !== undefined || compactions.some((task) => task.blocking)) &&
			compactions.every((task) => task.retry);
		const execution: RuntimeActivityExecution = {
			phase: waiting
				? "waiting-input"
				: busy
					? retrying
						? "retrying"
						: "running"
					: activity?.activityIssue
						? "blocked"
						: "idle",
			...(runId ? { runId } : {}),
			...(retryAt === undefined ? {} : { retryAt }),
			...(activity?.activityIssue ? { issue: activity.activityIssue } : {}),
		};
		let summary = "";
		const input = live?.run?.inputs.at(-1);
		if (input !== undefined) {
			const submission = await this.storage.submission(input, C);
			const entry = submission?.entry ? await this.harness.commit((tx) => tx.entry(submission.entry!), C) : undefined;
			const message = entry?.model?.find((message) => message.role === "user");
			if (message)
				summary =
					typeof message.content === "string"
						? message.content
						: message.content
								.filter((block) => block.type === "text")
								.map((block) => block.text)
								.join(" ");
		}
		const text =
			live?.generation?.message?.content
				.filter((block) => block.type === "text")
				.map((block) => block.text)
				.join(" ") ?? "";
		const detail =
			execution.phase === "retrying"
				? "重试中"
				: execution.phase === "blocked"
					? "执行受阻"
					: waiting
						? "等待交互"
						: live?.compactions?.length
							? "整理上下文"
							: tools.length
								? `执行 ${[...new Set(tools)].join(" · ")}`
								: queued && !live?.run
									? "排队中"
									: busy
										? "生成回复"
										: "空闲";
		return {
			execution,
			state: waiting ? ("waiting" as const) : busy ? ("running" as const) : ("idle" as const),
			summary: summary.replace(/\s+/g, " ").trim().slice(0, 160),
			detail: detail.slice(0, 160),
			text: text.trim().slice(-240),
		};
	}

	async hasPendingWork(id: string, input?: string): Promise<boolean> {
		const live = await this.harness.snapshot(LiveDoc, cid(id), C);
		if (live?.run) {
			if (!input) return true;
			for (const source of await this.sources(live.run.inputs)) if (await this.causedBy(source, input)) return true;
		}
		const inbox = await this.harness.snapshot(InboxDoc, cid(id), C);
		for (const item of inbox?.items ?? [])
			if (item.mode !== "write") {
				if (!input) return true;
				const event = (item.entry?.data as { event?: string } | undefined)?.event;
				if (event && (await this.causedBy(await this.options.readEvent?.(event), input))) return true;
			}
		return this.hasBackgroundWork(id, undefined, input);
	}

	async executeCommand(
		config: RuntimeSessionConfig,
		request: { command: string | string[]; cwd?: string; signal?: AbortSignal },
	): Promise<{ stdout: string; stderr: string; exitCode: number }> {
		let stdout = "",
			stderr = "",
			truncated = false;
		const context = request.signal ? withAbortSignal(request.signal, C) : C;
		const result = getOrThrow(
			await this.environment(config).exec(
				request.command,
				{
					...(request.cwd ? { cwd: request.cwd } : {}),
					spill: { afterBytes: 65536, afterLines: 2000 },
					onOutput(text, _context, info) {
						if (info.stream === "stderr") {
							truncated ||= stderr.length + text.length > 65536;
							stderr = (stderr + text).slice(-65536);
						} else {
							truncated ||= stdout.length + text.length > 65536;
							stdout = (stdout + text).slice(-65536);
						}
					},
				},
				context,
			),
		);
		return {
			stdout: stdout + (truncated ? `\n[Output tail retained; full log: ${result.spillPath ?? "unavailable"}]` : ""),
			stderr,
			exitCode: result.exitCode,
		};
	}

	/**
	 * Poll only the accounts a stop line names. Without `quotaStopPercent` nothing is scheduled, so ordinary
	 * homes keep the no-extra-request behaviour of 07 §6.1.
	 */
	private pollQuota(
		fallback: RuntimeSessionConfig["resolved"]["fallback"],
		selection: RuntimeSessionConfig["resolved"]["credentialSlots"],
	): void {
		const stops = fallback?.quotaStopPercent;
		if (!stops) return;
		const accounts: Array<{ provider: string; slot: string }> = [];
		for (const [provider, slots] of Object.entries(fallback?.accounts ?? {}))
			for (const slot of slots) if (stops[slot] !== undefined) accounts.push({ provider, slot });
		for (const [provider, slot] of Object.entries(selection ?? {}))
			if (stops[slot] !== undefined) accounts.push({ provider, slot });
		this.quotaPoller.watch(accounts);
		this.quotaPoller.start();
	}

	async close(): Promise<void> {
		for (const state of this.limits.states.values()) {
			state.visibility.abort();
			clearTimeout(state.timer);
		}
		await this.restartNotes;
		this.quotaPoller.stop();
		this.watch.stop();
		await this.background.close();
		try {
			await this.harness.close(C);
		} finally {
			for (const state of this.limits.states.values()) {
				state.visibility.abort();
				clearTimeout(state.timer);
			}
		}
	}
}
