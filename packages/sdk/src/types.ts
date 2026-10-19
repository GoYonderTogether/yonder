import type { Credential, Message, Models } from "@earendil-works/pi-ai";
import type { ExecutionEnv } from "@earendil-works/pi-durable/env";
import type { TSchema } from "typebox";

export type { Credential, ExecutionEnv, Message, Models, TSchema };
export type Ref = string;
export type Capability = "read" | "write" | "exec" | "network" | "message" | "cross-agent" | "admin";
export type Level = "bypass" | "standard" | "readonly";
export type Mode = "main" | "persistent" | "ephemeral" | "task";

export interface YEvent {
	id: string;
	ts: string;
	type: string;
	parent?: string;
	from?: Ref;
	conv?: Ref;
	data: object;
	routes?: Route[];
}
export type EventInput = Pick<YEvent, "type" | "parent" | "from" | "conv" | "data">;
export interface Route {
	agent: string;
	binding: string | null;
	session?: string;
	wake?: "run" | "write";
	busy?: "followup" | "steer";
	waiting?: boolean;
	dropped?: "no-binding" | "agent-disabled" | "profile-mismatch";
}
export interface Attachment {
	kind: "image" | "audio" | "video" | "file";
	mime: string;
	uri: string;
	name?: string;
	bytes?: number;
}
export interface MessageInData {
	kind: string;
	text: string;
	attachments?: Attachment[];
	mentioned?: boolean;
	msgId?: string;
	replyTo?: string;
	name?: string;
	target?: string;
}
export interface MessageOutData {
	text: string;
	attachments?: Attachment[];
	session?: string;
	to?: Ref;
	delivery: Delivery;
}
export interface RunEndData {
	session: string;
	runId?: string;
	inputs: string[];
	status: "done" | "error" | "aborted" | "limit";
	reason?: string;
	replied: "source" | "caller" | "deliver" | "none";
	model: string;
	usage: { input: number; output: number; cacheRead: number; cacheWrite: number; cost: number };
}
export interface SessionOpenData {
	session: string;
	mode: Mode;
	key: string;
	profile: string;
}
export interface SessionCloseData {
	session: string;
	reason: string;
}
export interface SessionInputData {
	session: string;
	text: string;
}
export interface IdentityLinkData {
	account: Ref;
	person: Ref;
	linked: boolean;
}
export interface ConfigReloadData {
	file: string;
	ok: boolean;
	errors?: string[];
}

export interface EventQuery {
	type?: string;
	from?: Ref;
	conv?: Ref;
	agent?: string;
	since?: string;
	until?: string;
	after?: string;
	limit?: number;
}
export interface EventPage {
	events: YEvent[];
	next?: string;
}
export interface Profile {
	model?: string;
	thinking?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
	level?: Level;
	capabilities?: Capability[];
	plugins?: string[];
	tools?: { offer?: string[]; search?: string[] };
	contexts?: string[];
	skills?: string[];
	instructions?: string;
	env?: string;
	limits?: { maxTurns?: number; maxMinutes?: number; repeatBlock?: number; repeatStop?: number };
}
export type Preset = Profile & { id: string; description: string };

export interface SessionUpdate {
	session?: string;
	runId?: string;
	eventIds?: string[];
	type: "snapshot" | "message" | "tool" | "state" | "error" | "end" | "inbox";
	event?: object;
	id?: string;
	message?: object;
	messages?: Array<{ id: string; message: object }>;
	streaming?: boolean;
	running?: boolean;
	inputs?: string[];
	inbox?: Array<{ id: string; mode: string }>;
	tool?: { id: string; name: string; args?: object; phase: "start" | "update" | "end"; text?: string; result?: object };
	error?: string;
}

export interface SessionsAPI {
	list(filter: { agent?: string; mode?: Mode; open?: boolean }): Promise<SessionInfo[]>;
	get(id: string): Promise<SessionInfo | undefined>;
	open(req: {
		preset: string;
		parent?: string;
		capabilities?: Capability[];
		close?: "run-end" | "manual";
	}): Promise<SessionInfo>;
	submit(id: string, input: Input, opts: { wait: true; busy?: "followup" | "steer" }): Promise<RunResult>;
	submit(id: string, input: Input, opts: { wait?: false; busy?: "followup" | "steer" }): Promise<InputReceipt>;
	submit(
		id: string,
		input: Input,
		opts?: { wait?: boolean; busy?: "followup" | "steer" },
	): Promise<RunResult | InputReceipt>;
	abort(id: string): Promise<void>;
	close(id: string): Promise<void>;
	transcript(id: string, range?: { from?: number; limit?: number }): Promise<TranscriptItem[]>;
	observe?(id: string, send: (update: SessionUpdate) => Promise<void>): Promise<() => Promise<void>>;
}
export interface SessionInfo {
	close?: "run-end" | "manual";
	id: string;
	agent: string | null;
	profile: string;
	mode: Mode;
	key: string;
	parent?: string;
	version: string;
	opened: string;
	closed?: string;
}
export interface Input {
	text: string;
	attachments?: Attachment[];
}
export interface InputReceipt {
	event: string;
	session: string;
}
export interface RunResult {
	agent: string | null;
	session: string;
	status: "done" | "error" | "aborted" | "limit";
	text: string;
	reason?: string;
	attachments?: Attachment[];
}
export interface TranscriptItem {
	id: number;
	kind: string;
	text: string;
	tools?: Array<{ name: string; args: object }>;
	event?: string;
}
export interface IdentityAPI {
	account(ref: Ref): Promise<AccountInfo | undefined>;
	person(ref: Ref): Promise<PersonInfo | undefined>;
	createPerson(p: { id: string; name: string; note?: string }): Promise<PersonInfo>;
	link(account: Ref, person: Ref): Promise<void>;
	unlink(account: Ref): Promise<void>;
	relation(agent: string, account: Ref): Promise<"owner" | "known" | "stranger">;
	lookup(ref: Ref): Promise<Lookup>;
}
export interface AccountInfo {
	ref: Ref;
	person?: Ref;
	name?: string;
	firstSeen: string;
	lastSeen: string;
}
export interface PersonInfo {
	ref: Ref;
	name: string;
	note?: string;
	accounts: Ref[];
}
export interface Lookup {
	accounts: AccountInfo[];
	convs: Ref[];
	agents: string[];
}

export interface ChannelProvider {
	type: string;
	configSchema?: TSchema;
	create(id: string, config: unknown): Channel | Promise<Channel>;
}
export interface Channel {
	id: string;
	kinds: string[];
	output: { stream: boolean; attachments: boolean };
	start(io: ChannelIO): Promise<void>;
	stop(signal?: AbortSignal): Promise<void>;
	send(target: Ref, msg: OutMessage, signal?: AbortSignal): Promise<Delivery>;
	stream?(conv: Ref, out: AsyncIterable<OutputPart>, replyTo?: string, signal?: AbortSignal): Promise<Delivery>;
}
export interface ChannelIO {
	emit(e: EventInput): Promise<YEvent>;
	ask(e: EventInput): Promise<AskResult>;
}
export interface AskResult {
	event: YEvent;
	results: RunResult[];
}
export interface OutMessage {
	text: string;
	/** Automatic reply source; explicit replyTo still forces a quoted reply. */
	sourceMessageId?: string;
	attachments?: Attachment[];
	replyTo?: string;
}
export interface Delivery {
	ok: boolean;
	uncertain?: boolean;
	id?: string;
	error?: string;
}
export type OutputPart =
	| { type: "text"; delta: string }
	| { type: "tool"; phase: "start" | "end"; name: string; label?: string; ok?: boolean }
	| { type: "final"; text: string }
	| { type: "error"; message: string };

export interface Tool {
	name: string;
	description: string;
	parameters: TSchema;
	capabilities: Capability[];
	execute(args: unknown, ctx: ToolContext): Promise<ToolResult>;
}
export interface ToolContext {
	agent: string | null;
	profile: string;
	session: string;
	capabilities: Capability[];
	env: ExecutionEnv;
	event?: YEvent;
	/** Actual inputs of this native run, including placed steer inputs. */
	events?: YEvent[];
	signal: AbortSignal;
}
export interface ToolResult {
	text: string;
	attachments?: Attachment[];
	images?: Array<{ mime: string; data: string }>;
	isError?: boolean;
}
export interface ContextContribution {
	id: string;
	placement: "system" | "turn";
	files?: Array<{ path: string; template?: string; scaffold: boolean; protect?: Capability }>;
	render(ctx: RenderContext): string | undefined | Promise<string | undefined>;
}
export interface RenderContext {
	agent: string;
	profile: string;
	session: string;
	workspace: { read(path: string): Promise<string | undefined> };
	event?: YEvent;
	signal?: AbortSignal;
}
export interface Trigger {
	id: string;
	start(io: { emit(e: EventInput): Promise<YEvent> }): Promise<void>;
	stop(): Promise<void>;
}
export interface EnvProvider {
	type: string;
	configSchema?: TSchema;
	create(id: string, config: unknown): Promise<ExecutionEnv>;
}
export interface Hook {
	id: string;
	beforeTool?(call: ToolCall, ctx: ToolContext): HookResult<{ block: string } | { args: object }>;
	afterTool?(call: ToolCall, result: ToolResult, ctx: ToolContext): HookResult<{ result: ToolResult }>;
	beforeRequest?(messages: Message[], ctx: ToolContext): HookResult<{ messages: Message[] }>;
}
export interface ToolCall {
	id: string;
	name: string;
	args: object;
}
export type HookResult<T> = T | undefined | Promise<T | undefined>;
export interface ServiceEndpoint {
	id: string;
	protocol: string;
	baseUrl: string;
	apiKey?: string;
	models: string[];
	voices?: string[];
}

export interface PluginAPI {
	id: string;
	config: unknown;
	log: {
		info(msg: string, data?: object): void;
		warn(msg: string, data?: object): void;
		error(msg: string, data?: object): void;
	};
	channels: { register(c: ChannelProvider): void };
	tools: { register(t: Tool): void };
	contexts: { register(c: ContextContribution): void };
	triggers: { register(t: Trigger): void };
	envs: { register(e: EnvProvider): void };
	hooks: { register(h: Hook): void };
	presets: { register(p: Preset): void };
	skills: { register(dir: string): void };
	events: {
		emit(e: EventInput): Promise<YEvent>;
		ask(e: EventInput): Promise<AskResult>;
		query(q: EventQuery): Promise<EventPage>;
		on(type: string, handler: (e: YEvent) => void | Promise<void>): void;
	};
	messages: {
		send(
			m: {
				to: Ref;
				via?: string;
				text: string;
				replyTo?: string;
				attachments?: Attachment[];
				signal?: AbortSignal;
			},
			ctx?: ToolContext,
		): Promise<Delivery>;
	};
	credentials: { get(name: string): Promise<Credential | undefined> };
	sessions: SessionsAPI;
	identity: IdentityAPI;
	services: { resolve(capability: string): Promise<ServiceEndpoint | undefined> };
	models: Models;
	paths: { data: string };
}
export interface PluginModule {
	setup(api: PluginAPI): void | Promise<void>;
	configSchema?: TSchema;
}
