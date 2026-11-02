import type { Context } from "@earendil-works/chord";
import type {
	Conversation,
	Extension,
	Harness,
	Registry,
	RunReceiptState,
	Storage,
	Submission,
	SubmissionId,
	ToolExecutionApi,
	ToolRegistration,
} from "@earendil-works/pi-durable";
import type { ImageProcessor } from "@earendil-works/pi-durable/tools";
import type {
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
import type {
	RuntimeBackground,
	RuntimeCredentialSlots,
	RuntimeLimits,
	RuntimeModelGate,
	RuntimeModelHealth,
	RuntimeModelQuota,
	RuntimeModels,
	RuntimeModelWatch,
	RuntimePolicy,
	RuntimeQuotaPoller,
} from "../contracts.js";
import type {
	RuntimeActivityExecution,
	RuntimeInput,
	RuntimeOptions,
	RuntimeRun,
	RuntimeSessionConfig,
	RuntimeSessionState,
} from "../types.js";
import type { CatalogTool } from "./catalog.js";
import type { Outbox } from "./outbox.js";
import type { TerminalUpdate } from "./terminal.js";

/** One catalog entry plus the exposure decision `describeCatalog` made for it. */
export type ToolExposure = CatalogTool & { missing: string[]; exposure: string };

/** What `Runtime.modelStatus` reports: the selected model, the context, and every task of the session's scope. */
export interface ModelStatus {
	model: { provider: string; id: string; contextWindow: number; maxTokens: number } | null;
	thinking: string | undefined;
	primary: string;
	fallback: RuntimeSessionConfig["resolved"]["fallback"];
	failures: number;
	running: boolean;
	contextTokens: number;
	compact: { available: boolean; reason: string; tasks: string[]; failure: string | undefined };
	tasks: Array<{
		name: string | undefined;
		model: string | undefined;
		thinking: string | undefined;
		targetAgent: string | undefined;
		id: string;
		session: string;
		kind: string;
		owner: string | undefined;
		background: boolean;
		state: string;
	}>;
}

/** One queued input of a session as `Runtime.queued` reports it. */
export interface QueuedItem {
	id: string;
	mode: string;
	text: string;
	event?: string;
}

/** Owner-local execution facts as `Runtime.activity` reports them. */
export interface Activity {
	execution: RuntimeActivityExecution;
	state: "running" | "waiting" | "idle";
	summary: string;
	detail: string;
	text: string;
}

/**
 * The state one `Runtime` owns, as seen by the functions its methods delegate to.
 *
 * Every field stays on the class: a single owner keeps the order of mutations visible in one place, and the
 * extracted functions read and write that state through `rt` instead of capturing it. That matters for `harness`,
 * `outbox`, `storage` and `background`, which only exist after `Runtime.open` has run. `Runtime` hands itself over
 * through one typed getter, so the cast lives in exactly one place.
 */
export interface RuntimeInternals {
	cloud: {
		providers: Record<string, { name?: string; baseUrl?: string; api?: string; models?: unknown[] }>;
		apiKeys: Map<string, string>;
		issues: Array<{ instance: string; code: string; message: string }>;
	};
	settledEvents: Map<string, string>;
	harness: Harness;
	outbox: Outbox;
	restoring: boolean;
	restartNotes: Promise<void>;
	interrupted: Array<{ session: string; run: string }>;
	images?: Promise<ImageProcessor>;
	storage: Storage;
	finishing: Map<string, Promise<RuntimeRun>>;
	idleWaiters: Map<string, Set<() => void>>;
	recovering: Array<{ session: string; id: SubmissionId }>;
	registry: Registry<ToolRegistration>;
	background: RuntimeBackground;
	rawTools: Map<string, ToolRegistration>;
	sdkToolNames: Set<string>;
	toolGuidelines: Map<string, readonly string[]>;
	invocationConfigs: WeakMap<
		Context,
		{
			config: RuntimeSessionConfig;
			operationPrefix?: string;
			operationSequence: number;
			events: YEvent[];
			runId?: string;
		}
	>;
	extensions: Map<string, Extension>;
	tools: Map<string, ToolRegistration>;
	capabilities: Map<string, Capability[]>;
	configured: Map<string, RuntimeSessionConfig>;
	activeLazy: Set<string>;
	submissions: Map<string, { event?: RuntimeInput["event"] }>;
	toolInvocations: WeakMap<ToolContext, { api: ToolExecutionApi; context: Context }>;
	readonly credentialSlots: RuntimeCredentialSlots;
	readonly boundModels: WeakMap<RuntimeSessionConfig, Promise<Models>>;
	readonly health: RuntimeModelHealth;
	readonly quota: RuntimeModelQuota;
	readonly gate: RuntimeModelGate;
	readonly watch: RuntimeModelWatch;
	readonly quotaPoller: RuntimeQuotaPoller;
	readonly credentials: import("@earendil-works/pi-ai").CredentialStore;
	readonly policy: RuntimePolicy;
	readonly limits: RuntimeLimits;
	readonly models: RuntimeModels;
	readonly options: RuntimeOptions;

	/** Entry points on `Runtime` the extracted modules call back into; each one delegates to a module again. */
	imageProcessor(): Promise<ImageProcessor>;
	modelsFor(config: RuntimeSessionConfig): Promise<Models>;
	environment(config: RuntimeSessionConfig): ExecutionEnv;
	conversation(id: string): Promise<Conversation>;
	context(id: string, context: Context): Promise<ToolContext>;
	toolContext(id: string, context: Context): Promise<ToolContext>;
	currentConfig(id: string): RuntimeSessionConfig | undefined;
	sessionConfig(id: string): Promise<RuntimeSessionConfig>;
	prepareRun(session: string, context: Context): Promise<void>;
	preparePlacedInputs(session: string, config: RuntimeSessionConfig, started: number, context: Context): Promise<void>;
	install(): void;
	backgroundTool(tool: ToolRegistration): ToolRegistration;
	adapter(name: string, tools: Tool[], hooks: Hook[]): Extension;
	assertToolContext(ctx: ToolContext): void;
	authorizeAttachments(ctx: ToolContext, attachments?: import("@yonder/sdk").Attachment[]): Promise<void>;
	create(meta: {
		agent: string | null;
		profile: string;
		cwd: string;
		env?: string;
		capabilities?: Capability[];
		channelInstances?: string[];
		inherit?: RuntimeSessionState["inherit"];
		close?: "run-end" | "manual";
	}): Promise<string>;
	fork(id: string, at: number): Promise<string>;
	forkParent(id: string): Promise<{ id: string; at: number } | undefined>;
	setSessionState(id: string, state: RuntimeSessionState): Promise<void>;
	describeTools(config: RuntimeSessionConfig): ToolExposure[];
	lazyGroupsOf(id: string, names: string[]): string[];
	applyRequestedEffort(session: string, config: RuntimeSessionConfig, context: Context): Promise<void>;
	attachSubmission(submission: Submission, event: RuntimeInput["event"], session: string): Promise<void>;
	settleActivity(
		session: string,
		runId: string,
		receipt: Readonly<RunReceiptState>,
		saved: { error: string | null; reason: string | null },
	): Promise<void>;
	activateTools(id: string, names: string[]): Promise<string[]>;
	deactivateTools(id: string, names: string[]): Promise<string[]>;
	configure(id: string): Promise<void>;
	applyConfiguration(id: string, config: RuntimeSessionConfig): Promise<void>;
	configureModels(id: string, models: SessionModels | null): Promise<void>;
	modelStatus(id: string): Promise<ModelStatus>;
	notificationRecorded(id: string, from: string, event: string): Promise<boolean>;
	notify(id: string, input: { from: string; event: string; text: string }): Promise<string>;
	submit(id: string, input: RuntimeInput, accepted?: () => void): Promise<RuntimeRun>;
	invocationId(ctx: ToolContext): string;
	abort(id: string): Promise<void>;
	queued(id: string, withdraw?: boolean): Promise<QueuedItem[]>;
	observe(id: string, send: (update: TerminalUpdate) => Promise<void>): Promise<() => void>;
	transcript(id: string, range?: { from?: number; limit?: number; before?: number }): Promise<TranscriptItem[]>;
	usage(id: string): Promise<RuntimeRun["usage"]>;
	runTask(ctx: ToolContext, initialize: (childId: string) => Promise<RuntimeInput>): Promise<RuntimeRun>;
	sources(ids: readonly number[]): Promise<YEvent[]>;
	receiptRun(session: string, key: string, receipt: Readonly<RunReceiptState>): Promise<RuntimeRun>;
	settledRun(session: string, submission: Awaited<ReturnType<Submission["wait"]>>): Promise<RuntimeRun>;
	hasPendingWork(id: string, input?: string): Promise<boolean>;
	idleChanged(session: string): Promise<void>;
	causedBy(source: YEvent | undefined, input: string): Promise<boolean>;
	lastResult(
		session: string,
		input?: string,
	): Promise<{ runId: string; status: RuntimeRun["status"]; reason?: string } | undefined>;
	admitted(session: string, event: string): Promise<boolean>;
	writeNote(id: string, requestId: string, text: string): Promise<void>;
	resolveService(capability: string): Promise<ServiceEndpoint | undefined>;
	login(provider: string, type: "api_key" | "oauth", interaction: Parameters<Models["login"]>[2]): Promise<void>;
	hasBackgroundWork(id: string, except?: number, input?: string): Promise<boolean>;
	hasOtherBackgroundWork(ctx: ToolContext): Promise<boolean>;
	hasAwakeWork(id: string): Promise<boolean>;
	backgroundList(session: string): ReturnType<RuntimeBackground["list"]>;
	backgroundAction(
		session: string,
		args: { action: "status" | "log" | "kill"; id: string; offset?: number },
	): ReturnType<RuntimeBackground["manage"]>;
	backgroundChild(session: string, id: string): Promise<{ session: string; state: string }>;
	activity(id: string): Promise<Activity>;
	executeCommand(
		config: RuntimeSessionConfig,
		request: { command: string | string[]; cwd?: string; signal?: AbortSignal },
	): Promise<{ stdout: string; stderr: string; exitCode: number }>;
	pollQuota(
		fallback: RuntimeSessionConfig["resolved"]["fallback"],
		selection: RuntimeSessionConfig["resolved"]["credentialSlots"],
	): void;
	close(): Promise<void>;
}
