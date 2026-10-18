import type { Attachment, Capability, ExecutionEnv, Hook, OutputPart, RunEndData, Tool, YEvent } from "@yonder/sdk";
import type { Binding, ResolvedProfile, YonderConfig } from "../config/index.js";
import type { Db } from "./db.js";
export interface RuntimeSessionConfig {
	agent: string | null;
	profile: string;
	cwd: string;
	resolved: ResolvedProfile;
	protectedFiles?: Array<{ path: string; capability: Capability }>;
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
	onRun?(session: string, run: RuntimeRun): Promise<void>;
	onAdmitted?(session: string, input: RuntimeInput): Promise<void>;
	onReport?(error: unknown): void;
}
export interface RuntimeInput {
	text: string;
	event?: YEvent;
	attachments?: Attachment[];
	wake?: "run" | "write";
	version?: string;
	busy?: "followup" | "steer";
	onOutput?(part: OutputPart, runId?: string): void;
	requestId?: string;
}
export interface RuntimeRun {
	runId: string;
	status: RunEndData["status"];
	text: string;
	reason?: string;
	usage: RunEndData["usage"];
	inputs: string[];
	config?: RuntimeSessionConfig;
}

export interface RuntimeSessionState {
	close?: "run-end" | "manual";
	agent: string | null;
	profile: string;
	cwd: string;
	env: string;
	capabilities?: Capability[];
}
