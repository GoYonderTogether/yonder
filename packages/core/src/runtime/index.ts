// The fields below are read and written by the modules under runtime/, through the `rt` view of this instance, so
// Biome sees no reader in this file. Keeping them here makes this class the one owner of the mutable state.
// biome-ignore-all lint/correctness/noUnusedPrivateClassMembers: state is used through the internals view
import { join } from "node:path";
import type { Context } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT as C, withAbortSignal } from "@earendil-works/chord/context";
import {
	createRegistry,
	type Extension,
	type Harness,
	InboxDoc,
	LiveDoc,
	RunReceiptDoc,
	type RunReceiptState,
	type Submission,
	type ToolExecutionApi,
	type ToolRegistration,
} from "@earendil-works/pi-durable";
import { getOrThrow } from "@earendil-works/pi-durable/env";
import type { SqliteStorage } from "@earendil-works/pi-durable/storage/sqlite";
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
import { loginProvider } from "./auth.js";
import type { createBackground } from "./background.js";
import { capabilityMap } from "./catalog.js";
import { CredentialSlotStore } from "./credential-slots.js";
import { credentialPath, type FileCredentials } from "./credentials.js";
import { runTask } from "./delegation.js";
import { cid, RunDoc, SessionDoc, submissionOutcome } from "./docs.js";
import type { RuntimeInternals } from "./instance.js";
import {
	closeRuntime,
	conversationOf,
	environment,
	imageProcessor,
	modelsFor,
	openRuntime,
	pollQuota,
	toolContext,
} from "./lifecycle.js";
import { RunLimits } from "./limits.js";
import { ModelGate } from "./model-gate.js";
import { ModelHealth } from "./model-health.js";
import { ModelQuota } from "./model-quota.js";
import { compact, modelStatus } from "./model-status.js";
import { ModelWatch } from "./model-watch.js";
import { buildModels } from "./models.js";
import { observe, sessionUsage, terminalHistory, transcript } from "./observe.js";
import type { Outbox } from "./outbox.js";
import { ToolPolicy } from "./policy.js";
import { QuotaPoller, QuotaSource } from "./quota-source.js";
import { receiptRun, settleActivity, settledRun, sources } from "./receipts.js";
import { RESTART_NOTICE } from "./recovery.js";
import { runtimeNote } from "./runtime-note.js";
import type { RuntimeOptions } from "./runtime-options.js";
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

export { attachmentFromPath } from "./attachments.js";
export { inspectToolCatalog } from "./catalog.js";
export { submissionOutcome } from "./docs.js";

import type { TerminalUpdate } from "./terminal.js";
import { entryText as textOf } from "./transcript.js";
import type {
	RuntimeActivityExecution,
	RuntimeInput,
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
	private settledEvents = new Map<string, string>();
	private harness!: Harness;
	private outbox!: Outbox;
	private restoring = false;
	private restartNotes = Promise.resolve();
	private interrupted: Array<{ session: string; run: string }> = [];
	private images?: Promise<ImageProcessor>;
	private storage!: SqliteStorage;
	private finishing = new Map<string, Promise<RuntimeRun>>();
	private idleWaiters = new Map<string, Set<() => void>>();
	private recovering: Array<{ session: string; id: import("@earendil-works/pi-durable").SubmissionId }> = [];
	private registry = createRegistry();
	private background!: ReturnType<typeof createBackground>;
	private rawTools = new Map<string, ToolRegistration>();
	private sdkToolNames = new Set<string>();
	private toolGuidelines = new Map<string, readonly string[]>();
	private invocationConfigs = new WeakMap<
		Context,
		{ config: RuntimeSessionConfig; events: import("@yonder/sdk").YEvent[] }
	>();
	private extensions = new Map<string, Extension>();
	private tools = new Map<string, ToolRegistration>();
	private capabilities = new Map<string, Capability[]>(Object.entries(capabilityMap));
	private configured = new Map<string, RuntimeSessionConfig>();
	private activeLazy = new Set<string>();
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
			onHealth: (event) => this.options.onModelHealth?.(event),
			onReport: (error) => this.options.onReport?.(error),
		});
		this.quotaPoller = new QuotaPoller(new QuotaSource(authPath), this.quota, 60_000, (error) =>
			options.onReport?.(error),
		);
		this.models = buildModels(this.credentials, options.config.models?.providers);
		this.policy = new ToolPolicy({
			home: options.home,
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
		return imageProcessor(this.rt);
	}
	static async open(options: RuntimeOptions): Promise<Runtime> {
		const runtime = new Runtime(options);
		await openRuntime(runtime.rt, options);
		return runtime;
	}
	private modelsFor(config: RuntimeSessionConfig): Promise<Models> {
		return modelsFor(this.rt, config);
	}
	private environment(config: RuntimeSessionConfig): ExecutionEnv {
		return environment(this.rt, config);
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
		return installExtensions(this.rt);
	}
	private backgroundTool(tool: ToolRegistration): ToolRegistration {
		return backgroundTool(this.rt, tool);
	}
	private adapter(name: string, tools: Tool[], hooks: Hook[]): Extension {
		return adapter(this.rt, name, tools, hooks);
	}
	assertToolContext(ctx: ToolContext): void {
		assertToolContext(this.rt, ctx);
	}
	async authorizeAttachments(ctx: ToolContext, attachments: Attachment[] = []): Promise<void> {
		await authorizeAttachments(this.rt, ctx, attachments);
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
						this.settledEvents.set(String(conversation.id), doc.key!);
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
			await this.outbox.deliver(String(conversation.id)).catch((error) => this.options.onReport?.(error));
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
		if (!this.options.onSessionSettled || (await this.hasPendingWork(session))) return;
		const result = await this.lastResult(session);
		if (result && this.settledEvents.get(session) !== result.runId) {
			this.settledEvents.set(session, result.runId);
			await this.options.onSessionSettled?.({ session, status: result.status === "limit" ? "idle" : result.status });
		}
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
		await (await this.conversation(id)).submit(runtimeNote(requestId, text), C);
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
	async hasAwakeWork(id: string): Promise<boolean> {
		const tasks = await this.storage.scanTasks(
			{ conversationId: cid(id), kind: "yonder.background" },
			Number.MAX_SAFE_INTEGER,
			undefined,
			C,
		);
		const pending = tasks.items.filter((task) => task.state.status !== "terminal");

		if (pending.some((task) => (task.input as { name?: string }).name !== "interaction_result")) return true;
		const inbox = await this.harness.snapshot(InboxDoc, cid(id), C);
		if (inbox?.items.some((item) => item.mode !== "write")) return true;
		const live = await this.harness.snapshot(LiveDoc, cid(id), C);
		const slots = live?.tools?.filter((slot) => slot.status !== "done") ?? [];
		return !!live?.run && !(slots.length > 0 && slots.every((slot) => slot.name === "interaction_result"));
	}
	async backgroundList(session: string) {
		return this.background.list(session, this.storage);
	}
	async backgroundAction(session: string, args: { action: "status" | "log" | "kill"; id: string; offset?: number }) {
		return this.background.manage(session, args);
	}
	async backgroundChild(session: string, id: string) {
		const job = await this.background.manage(session, { action: "status", id });
		if (!("name" in job) || job.name !== "task_run") throw new Error("Not a delegated task");
		const page = await this.harness.commit((tx) => tx.scanConversations({ ownerTaskId: Number(id) as never }, 1), C);
		if (!page.items[0]) throw new Error("Child task has not started");
		return { session: String(page.items[0].id), state: job.state };
	}
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
			tools.every((name) => name === "interaction_result");
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
	private pollQuota(
		fallback: RuntimeSessionConfig["resolved"]["fallback"],
		selection: RuntimeSessionConfig["resolved"]["credentialSlots"],
	): void {
		pollQuota(this.rt, fallback, selection);
	}
	async close(): Promise<void> {
		await closeRuntime(this.rt);
	}
}
