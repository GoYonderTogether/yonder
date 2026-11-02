// The fields below are read and written by the modules under runtime/, through the `rt` view of this instance, so
// Biome sees no reader in this file. Keeping them here makes this class the one owner of the mutable state.
// biome-ignore-all lint/correctness/noUnusedPrivateClassMembers: state is used through the internals view
import type { Context } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT as C } from "@earendil-works/chord/context";
import type { Storage } from "@earendil-works/pi-durable";
import {
	createRegistry,
	type Extension,
	type Harness,
	LiveDoc,
	type RunReceiptState,
	type Submission,
	type ToolExecutionApi,
	type ToolRegistration,
} from "@earendil-works/pi-durable";
import type { ImageProcessor } from "@earendil-works/pi-durable/tools";
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
} from "@yonder/sdk";
import type { RuntimeBackground, RuntimeModels, RuntimeServices } from "../contracts.js";
import type { RuntimeOptions } from "../types.js";
import {
	activity,
	backgroundAction,
	backgroundChild,
	backgroundList,
	hasAwakeWork,
	hasBackgroundWork,
	hasOtherBackgroundWork,
} from "./background-query.js";
import { capabilityMap } from "./catalog.js";
import { runTask } from "./delegation.js";
import { cid } from "./docs.js";
import type { RuntimeInternals } from "./instance.js";
import { closeRuntime, conversationOf, openRuntime, pollQuota, toolContext } from "./lifecycle.js";
import { RunLimits } from "./limits.js";
import { compact, modelStatus } from "./model-status.js";
import { observe, sessionUsage, terminalHistory, transcript } from "./observe.js";
import type { Outbox } from "./outbox.js";
import { ToolPolicy } from "./policy.js";
import { receiptRun, settleActivity, settledRun, sources } from "./receipts.js";
import {
	admitted,
	causedBy,
	idleChanged,
	lastResult,
	recover,
	responseText,
	resultText,
	resume,
} from "./recovery-resume.js";
import { hasPendingWork, writeNote } from "./services.js";
import {
	applyRequestedEffort,
	currentConfig,
	preparePlacedInputs,
	prepareRun,
	sessionConfig,
} from "./session-config.js";
import { createSession, fork, parentOf, sessionState, setSessionState } from "./session-lifecycle.js";
import {
	abort,
	attachSubmission,
	enqueue,
	invocationId,
	notificationRecorded,
	notify,
	queued,
	submit,
} from "./submit.js";
import {
	adapter,
	assertToolContext,
	authorizeAttachments,
	backgroundTool,
	installExtensions,
} from "./tool-activation.js";
import {
	activateTools,
	applyConfiguration,
	configure,
	configureModels,
	deactivateTools,
	describeTools,
	lazyGroupsOf,
} from "./tool-config.js";

export { inspectToolCatalog } from "./catalog.js";
export { submissionOutcome } from "./docs.js";
export { noEnvironment } from "./no-environment.js";

import type { RuntimeInput, RuntimeRun, RuntimeSessionConfig, RuntimeSessionState } from "../types.js";
import type { TerminalUpdate } from "./terminal.js";

export type * from "../types.js";
export { canonicalPath, workspaceFiles } from "../workspace-files.js";
export type { TerminalUpdate } from "./terminal.js";
export { readTranscript } from "./transcript.js";

export class Runtime {
	readonly cloud = {
		providers: {} as Record<string, { name?: string; baseUrl?: string; api?: string; models?: unknown[] }>,
		apiKeys: new Map<string, string>(),
		issues: [] as Array<{ instance: string; code: string; message: string }>,
	};
	private settledEvents = new Map<string, string>();
	private harness!: Harness;
	private outbox!: Outbox;
	private restoring = false;
	private restartNotes = Promise.resolve();
	private interrupted: Array<{ session: string; run: string }> = [];
	private images?: Promise<ImageProcessor>;
	private storage!: Storage;
	private finishing = new Map<string, Promise<RuntimeRun>>();
	private idleWaiters = new Map<string, Set<() => void>>();
	private recovering: Array<{ session: string; id: import("@earendil-works/pi-durable").SubmissionId }> = [];
	private registry = createRegistry();
	private background!: RuntimeBackground;
	private rawTools = new Map<string, ToolRegistration>();
	private sdkToolNames = new Set<string>();
	private toolGuidelines = new Map<string, readonly string[]>();
	private invocationConfigs = new WeakMap<
		Context,
		{
			config: RuntimeSessionConfig;
			operationPrefix?: string;
			operationSequence: number;
			events: import("@yonder/sdk").YEvent[];
		}
	>();
	private extensions = new Map<string, Extension>();
	private tools = new Map<string, ToolRegistration>();
	private capabilities = new Map<string, Capability[]>(Object.entries(capabilityMap));
	private configured = new Map<string, RuntimeSessionConfig>();
	private activeLazy = new Set<string>();
	private submissions = new Map<string, { event?: RuntimeInput["event"] }>();
	private toolInvocations = new WeakMap<ToolContext, { api: ToolExecutionApi; context: Context }>();
	private readonly credentialSlots: RuntimeServices["credentialSlots"];
	private readonly boundModels = new WeakMap<RuntimeSessionConfig, Promise<Models>>();
	private readonly health: RuntimeServices["health"];
	private readonly quota: RuntimeServices["quota"];
	private readonly gate: RuntimeServices["gate"];
	private readonly watch: RuntimeServices["watch"];
	private readonly quotaPoller: RuntimeServices["quotaPoller"];
	readonly credentials: RuntimeServices["credentials"];
	private readonly policy: ToolPolicy;
	private readonly limits: RunLimits;
	readonly models: RuntimeModels;
	private constructor(private options: RuntimeOptions) {
		const services = options.services;
		this.credentialSlots = services.credentialSlots;
		this.credentials = services.credentials;
		this.health = services.health;
		this.quota = services.quota;
		this.gate = services.gate;
		this.watch = services.watch;
		this.quotaPoller = services.quotaPoller;
		this.models = services.models;
		this.policy = new ToolPolicy({
			home: options.home,
			capabilities: this.capabilities,
			environment: (config) => this.environment(config),
			context: (session, context) => this.context(session, context),
			fileURLToPath: (uri) => options.services.toolHost.fileURLToPath(uri),
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
					lastToolAt: state.lastToolAt,
					signal: state.visibility.signal,
					config: state.config,
					inputs: await this.sources(live?.run?.inputs ?? []),
				});
			},
			usage: (session) => this.usage(session),
			denied: (name, args, config, context, session) => this.policy.denied(name, args, config, context, session),
		});
	}

	/**
	 * The instance typed as the state its extracted modules use. This cast is the only place the class hands its
	 * private state out; every field is still declared here, so the class stays the one owner of the state.
	 */
	private get rt(): RuntimeInternals {
		return this as unknown as RuntimeInternals;
	}

	private imageProcessor(): Promise<ImageProcessor> {
		return this.options.services.imageProcessor();
	}
	static async open(options: RuntimeOptions): Promise<Runtime> {
		const runtime = new Runtime(options);
		options.services.attachRuntime?.(runtime.rt);
		await runtime.refreshModels();
		await openRuntime(runtime.rt, options);
		return runtime;
	}
	async refreshModels(): Promise<void> {
		await this.options.services.refreshModels?.();
	}
	private modelsFor(config: RuntimeSessionConfig): Promise<Models> {
		return this.options.services.modelsFor(config);
	}
	environment(config: RuntimeSessionConfig): ExecutionEnv {
		return this.options.services.environment(config);
	}
	private async context(id: string, context: Context): Promise<ToolContext> {
		return toolContext(this.rt, id, context);
	}
	currentConfig(id: string): RuntimeSessionConfig | undefined {
		return currentConfig(this.rt, id);
	}
	async sessionConfig(id: string): Promise<RuntimeSessionConfig> {
		return sessionConfig(this.rt, id);
	}
	private async prepareRun(session: string, context: Context): Promise<void> {
		await prepareRun(this.rt, session, context);
	}
	private async applyRequestedEffort(session: string, config: RuntimeSessionConfig, context: Context): Promise<void> {
		await applyRequestedEffort(this.rt, session, config, context);
	}
	private install() {
		return installExtensions(this.rt, this.options.services.toolHost);
	}
	private backgroundTool(tool: ToolRegistration): ToolRegistration {
		return backgroundTool(this.rt, tool);
	}
	private adapter(name: string, tools: Tool[], hooks: Hook[]): Extension {
		return adapter(this.rt, this.options.services.toolHost, name, tools, hooks);
	}
	assertToolContext(ctx: ToolContext): void {
		assertToolContext(this.rt, ctx);
	}
	async authorizeAttachments(ctx: ToolContext, attachments: Attachment[] = []): Promise<void> {
		await authorizeAttachments(this.rt, this.options.services.toolHost, ctx, attachments);
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
		return createSession(this.rt, meta);
	}
	async fork(id: string, at: number): Promise<string> {
		return fork(this.rt, id, at);
	}
	async forkParent(id: string): Promise<{ id: string; at: number } | undefined> {
		return parentOf(this.rt, id);
	}
	async sessionState(id: string): Promise<RuntimeSessionState | undefined> {
		return sessionState(this.rt, id);
	}
	async setSessionState(id: string, state: RuntimeSessionState): Promise<void> {
		await setSessionState(this.rt, id, state);
	}
	describeTools(config: RuntimeSessionConfig) {
		return describeTools(this.rt, config);
	}
	async activateTools(id: string, names: string[]): Promise<string[]> {
		return activateTools(this.rt, id, names);
	}
	async deactivateTools(id: string, names: string[]): Promise<string[]> {
		return deactivateTools(this.rt, id, names);
	}
	private lazyGroupsOf(id: string, names: string[]): string[] {
		return lazyGroupsOf(this.rt, id, names);
	}
	async configure(id: string): Promise<void> {
		await configure(this.rt, id);
	}
	private async applyConfiguration(id: string, config: RuntimeSessionConfig): Promise<void> {
		await applyConfiguration(this.rt, id, config);
	}
	async configureModels(id: string, models: SessionModels | null): Promise<void> {
		await configureModels(this.rt, id, models);
	}
	async modelStatus(id: string) {
		return modelStatus(this.rt, id);
	}
	async compact(id: string, instructions?: string): Promise<string> {
		return compact(this.rt, id, instructions);
	}
	private async conversation(id: string) {
		return conversationOf(this.rt, id);
	}
	private async preparePlacedInputs(
		session: string,
		config: RuntimeSessionConfig,
		started: number,
		context: Context,
	): Promise<void> {
		await preparePlacedInputs(this.rt, session, config, started, context);
	}
	async notificationRecorded(id: string, from: string, event: string) {
		return notificationRecorded(this.rt, id, from, event);
	}
	async notify(id: string, input: { from: string; event: string; text: string }) {
		return notify(this.rt, id, input);
	}
	async submit(id: string, input: RuntimeInput, accepted?: () => void): Promise<RuntimeRun> {
		return submit(this.rt, id, input, accepted);
	}
	async enqueue(id: string, input: RuntimeInput): Promise<void> {
		await enqueue(this.rt, id, input);
	}
	invocationId(ctx: ToolContext): string {
		return invocationId(this.rt, ctx);
	}
	private async attachSubmission(
		submission: Submission,
		event: RuntimeInput["event"],
		_session: string,
	): Promise<void> {
		await attachSubmission(this.rt, submission, event, _session);
	}
	async abort(id: string): Promise<void> {
		await abort(this.rt, id);
	}
	async queued(id: string, withdraw = false) {
		return queued(this.rt, id, withdraw);
	}
	async observe(id: string, send: (update: TerminalUpdate) => Promise<void>) {
		return observe(this.rt, id, send);
	}
	async terminalHistory(id: string) {
		return terminalHistory(this.rt, id);
	}
	async transcript(
		id: string,
		range: { from?: number; limit?: number; before?: number } = {},
	): Promise<TranscriptItem[]> {
		return transcript(this.rt, id, range);
	}
	async usage(id: string): Promise<RuntimeRun["usage"]> {
		return sessionUsage(this.rt, id);
	}
	async runTask(ctx: ToolContext, initialize: (childId: string) => Promise<RuntimeInput>): Promise<RuntimeRun> {
		return runTask(this.rt, ctx, initialize);
	}
	private async sources(ids: readonly number[]): Promise<import("@yonder/sdk").YEvent[]> {
		return sources(this.rt, ids);
	}
	private async receiptRun(session: string, key: string, receipt: Readonly<RunReceiptState>): Promise<RuntimeRun> {
		return receiptRun(this.rt, session, key, receipt);
	}
	private async settleActivity(
		session: string,
		runId: string,
		receipt: Readonly<RunReceiptState>,
		saved: { error: string | null; reason: string | null },
	): Promise<void> {
		await settleActivity(this.rt, session, runId, receipt, saved);
	}
	private async settledRun(session: string, done: Awaited<ReturnType<Submission["wait"]>>): Promise<RuntimeRun> {
		return settledRun(this.rt, session, done);
	}
	async recover(): Promise<void> {
		await recover(this.rt);
	}
	resume(): void {
		resume(this.rt);
	}
	private async idleChanged(session: string): Promise<void> {
		await idleChanged(this.rt, session);
	}
	private async causedBy(source: import("@yonder/sdk").YEvent | undefined, input: string): Promise<boolean> {
		return causedBy(this.rt, source, input);
	}
	async lastResult(session: string, input?: string) {
		return lastResult(this.rt, session, input);
	}
	async resultText(session: string, runId: string): Promise<string> {
		return resultText(this.rt, session, runId);
	}
	async responseText(session: string, event: string): Promise<string> {
		return responseText(this.rt, session, event);
	}
	async admitted(session: string, event: string): Promise<boolean> {
		return admitted(this.rt, session, event);
	}
	async resolveService(capability: string): Promise<ServiceEndpoint | undefined> {
		return this.options.services.resolveService(capability);
	}
	async login(provider: string, type: "api_key" | "oauth", interaction: Parameters<Models["login"]>[2]): Promise<void> {
		await this.options.services.login(provider, type, interaction);
	}
	async writeNote(id: string, requestId: string, text: string): Promise<void> {
		await writeNote(this.rt, id, requestId, text);
	}
	async hasBackgroundWork(id: string, except?: number, input?: string): Promise<boolean> {
		return hasBackgroundWork(this.rt, id, except, input);
	}
	async hasOtherBackgroundWork(ctx: ToolContext) {
		return hasOtherBackgroundWork(this.rt, ctx);
	}
	async hasAwakeWork(id: string): Promise<boolean> {
		return hasAwakeWork(this.rt, id);
	}
	async backgroundList(session: string) {
		return backgroundList(this.rt, session);
	}
	async backgroundAction(session: string, args: { action: "status" | "log" | "kill"; id: string; offset?: number }) {
		return backgroundAction(this.rt, session, args);
	}
	async backgroundChild(session: string, id: string) {
		return backgroundChild(this.rt, session, id);
	}
	async activity(id: string) {
		return activity(this.rt, id);
	}
	async hasPendingWork(id: string, input?: string): Promise<boolean> {
		return hasPendingWork(this.rt, id, input);
	}
	async executeCommand(
		config: RuntimeSessionConfig,
		request: { command: string | string[]; cwd?: string; signal?: AbortSignal },
	): Promise<{ stdout: string; stderr: string; exitCode: number }> {
		return this.options.services.executeCommand(config, request);
	}
	private pollQuota(
		fallback: RuntimeSessionConfig["resolved"]["fallback"],
		selection: RuntimeSessionConfig["resolved"]["credentialSlots"],
	): void {
		pollQuota(this.rt, fallback, selection);
	}
	async maintenance(now = Date.now()): Promise<void> {
		await Promise.all([this.watch.tick(now), this.quotaPoller.tick(now)]);
	}
	async close(): Promise<void> {
		await closeRuntime(this.rt);
	}
}
