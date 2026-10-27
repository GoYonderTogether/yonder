import type {
	Attachment,
	Capability,
	ExecutionEnv,
	Hook,
	OutputPart,
	RunEndData,
	SessionModels,
	Tool,
	ToolResult,
	YEvent,
} from "@yonder/sdk";
import type { Binding, ResolvedProfile, YonderConfig } from "../config/index.js";
import type { Db } from "./db.js";
export interface RuntimeSessionConfig {
	agent: string | null;
	profile: string;
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
export interface RuntimeOptions {
	db: Db;
	home: string;
	config: YonderConfig;
	plugins?: Array<{ id: string; tools: Tool[]; hooks: Hook[] }>;
	tools?: Tool[];
	envs?: Map<string, ExecutionEnv>;
	resolveSession(id: string): Promise<RuntimeSessionConfig>;
	sections?(session: RuntimeSessionConfig & { id: string }, signal?: AbortSignal): Promise<string[]>;
	readEvent?(id: string): Promise<YEvent | undefined>;
	/** True when this run already has its durable `run.end`; recover() then does not replay it. */
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
			config: RuntimeSessionConfig;
			signal?: AbortSignal;
			inputs: YEvent[];
		},
	): Promise<number | undefined>;
	tickIntervalMs?: number | undefined;
	onRun?(session: string, run: RuntimeRun): Promise<void>;
	onIdle?(session: string): Promise<void>;
	onBackground?(
		session: string,
		input: { id: string; name: string; result: ToolResult; origin?: YEvent },
	): Promise<void>;
	onWarning?(session: string, input: { kind: string; text: string; parent?: string }): Promise<void>;
	onAdmitted?(session: string, input: RuntimeInput): Promise<void>;
	/** Model health changed: a chain entry was held after a failed run, or a probe recovered it. */
	onModelHealth?(event: { key: string; state: "held" | "recovered"; reason?: string; until?: number }): void;
	onReport?(error: unknown): void;
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
	inherit?: { plugins: string[]; tools: { offer: string[]; search: string[] } };
}

/** Owner-local execution facts. Never includes native error text or tool payloads. */
export interface RuntimeActivityExecution {
	phase: "running" | "retrying" | "waiting-input" | "blocked" | "idle";
	runId?: string;
	retryAt?: number;
	issue?: { code: string; since: number; runId: string };
}
