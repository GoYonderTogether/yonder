import type {
	Attachment,
	Capability,
	ExecutionEnv,
	Hook,
	OutputPart,
	RunEndData,
	SessionInfo,
	SessionModels,
	Tool,
	ToolResult,
	YEvent,
} from "@yonder/sdk";
import type { Binding, ResolvedProfile, YonderConfig } from "../config/index.js";
import type { Db } from "./db.js";
import type { TodoUpdatedEvent } from "./todo.js";
export interface RuntimeSessionConfig {
	ownerWorkbench?: boolean;
	sessionId?: string;
	resources?: import("@yonder/sdk").WorkspaceResource[];
	agent: string | null;
	profile: string;
	/** Stored session mode when this resolves a real session rather than a profile preview. */
	sessionMode?: SessionInfo["mode"];
	cwd: string;
	resolved: ResolvedProfile;
	protectedFiles?: Array<{ path: string; capability: Capability }>;
	/** Set when a delegation asked for a per-run effort; persisted with the run snapshot. */
	effort?: { requested: string; effective: string; reason?: string; inputs: string[] };
	/** Non-secret named-account generation identities, fixed for this run and restored on reopen. */
	credentialGenerations?: Record<string, string>;
	bindings?: Binding[];
	owner?: string;
}
export interface PromptPart {
	key: string;
	text: string;
}

export interface RuntimeOptions {
	db: Db;
	home: string;
	config: YonderConfig;
	plugins?: Array<{ id: string; tools: Tool[]; hooks: Hook[] }>;
	tools?: Tool[];
	envs?: Map<string, ExecutionEnv>;
	deviceOperation?(
		config: RuntimeSessionConfig,
		deviceId: string,
		commandId: string,
		action: string,
		args: Record<string, unknown>,
		signal: AbortSignal,
	): Promise<unknown>;
	resolveSession(id: string): Promise<RuntimeSessionConfig>;
	/** System prompt parts in order; keyed parts become their own pi section when `sectionKeys` declares the key. */
	sections?(session: RuntimeSessionConfig & { id: string }, signal?: AbortSignal): Promise<Array<string | PromptPart>>;
	/** Every key `sections` may return, in default order. Keys must match `^[a-z][a-z0-9_-]*$`. */
	sectionKeys?: readonly string[];
	readEvent?(id: string): Promise<YEvent | undefined>;
	/** Group a routed input only by its verified original conversation; the runtime uses an event-local fallback. */
	sourceGroup?(session: string, eventId: string): Promise<string | undefined>;
	/** True when this run already has its durable `run.end`; receipt reads must not settle it again. */
	settled?(session: string, run: string): Promise<boolean>;
	prepareInput?(
		id: string,
		event: YEvent,
		config: RuntimeSessionConfig,
		wake: "run" | "write",
		signal?: AbortSignal,
	): Promise<RuntimeInput>;
	/** Shared run timer: deterministic owner visibility, never a model request. */
	onTick?(
		session: string,
		run: {
			runId: string;
			started: number;
			tools: number;
			lastToolAt: number;
			config: RuntimeSessionConfig;
			signal?: AbortSignal;
			inputs: YEvent[];
		},
	): Promise<number | undefined>;
	tickIntervalMs?: number | undefined;
	onRun?(session: string, run: RuntimeRun): Promise<void>;
	/**
	 * A finished run's usage, settled before `onRun` records it. The kernel checks session budgets here; the
	 * runtime itself stays below sessions (architecture §6, L1 < L2).
	 */
	onUsageSettled?(session: string, usage: RuntimeRun["usage"]): Promise<void>;
	onIdle?(session: string): Promise<void>;
	onBackgroundChanged?(session: string): void;
	onBackground?(
		session: string,
		input: { id: string; name: string; result: ToolResult; origin?: YEvent; outputFile?: string },
	): Promise<void>;
	onWarning?(session: string, input: { kind: string; text: string; parent?: string }): Promise<void>;
	onAdmitted?(session: string, input: RuntimeInput): Promise<void>;
	/** Model health changed: a chain entry was held after a failed run, or a probe recovered it. */
	onModelHealth?(event: { key: string; state: "held" | "recovered"; reason?: string; until?: number }): void;
	/**
	 * A session's answers moved to a fallback model, or came back to its primary (contracts §3.3 `model.fallback`).
	 * Fires once when an episode starts and once when it ends, never in between.
	 */
	onModelFallback?(event: ModelFallbackEvent): Promise<void>;
	/** The todo tool changed a session's list (contracts §3.4 `todo.updated`). */
	onTodo?(event: TodoUpdatedEvent): Promise<void>;
	onReport?(error: unknown): void;
}
export interface ModelFallbackEvent {
	session: string;
	inputs?: string[];
	state: "fallback" | "recovered";
	from: { provider: string; model: string };
	to: { provider: string; model: string };
	reason: "rate_limit" | "quota" | "unavailable" | "error";
}
export interface RuntimeInput {
	text: string;
	event?: YEvent;
	attachments?: Attachment[];
	wake?: "run" | "write";
	version?: string;
	busy?: "followup" | "steer" | "interrupt";
	onOutput?(part: OutputPart, runId?: string): void;
	requestId?: string;
}
export interface RuntimeRun {
	model?: string;
	session?: string;
	attachments?: Attachment[];
	runId: string;
	/** Native assistant generation timestamp, scoped to this run. */
	message?: string;
	status: RunEndData["status"];
	text: string;
	reason?: string;
	usage: RunEndData["usage"];
	inputs: string[];
	config?: RuntimeSessionConfig;
}

export interface RuntimeSessionState {
	workbench?: import("@yonder/sdk").SessionWorkbenchOptions;
	judgment?: boolean;
	models?: SessionModels;
	close?: "run-end" | "manual";
	agent: string | null;
	profile: string;
	cwd: string;
	env: string;
	capabilities?: Capability[];
	/** Effective instance ceiling captured at creation, including the preset restriction. */
	channelInstances?: string[];
	/** Parent tool surface captured when a preset session opens; fields the preset leaves unset are taken from here. */
	inherit?: import("../config/index.js").PresetInherit;
}

/** Owner-local execution facts. Never includes native error text or tool payloads. */
export interface RuntimeActivityExecution {
	phase: "running" | "retrying" | "waiting-input" | "blocked" | "idle";
	runId?: string;
	retryAt?: number;
	issue?: { code: string; since: number; runId: string };
}
