import type { Attachment } from "./messages.js";

export type * from "./messages.js";

import type { ChannelFeatures, NotificationIntent, SocialAPI } from "./social.js";

export type * from "./social.js";

import type { Credential, Message, Models } from "@earendil-works/pi-ai";
import type { ExecutionEnv } from "@earendil-works/pi-durable/env";
import type { TSchema } from "typebox";
import type { Preset } from "./models.js";
import type { SubagentTaskRequest } from "./subagents.js";
import type { PluginViewsAPI } from "./views.js";

export type { SubagentTaskRequest } from "./subagents.js";
export type * from "./views.js";
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
	busy?: "followup" | "steer" | "interrupt";
	waiting?: boolean;
	dropped?: "no-binding" | "agent-disabled" | "profile-mismatch";
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
	/** Thinking level this run actually used. */
	thinking?: string;
	/** Present when a delegation asked for a per-run effort (14 §5). */
	effort?: { requested: string; effective: string; reason?: string; inputs: string[] };
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
	/** Exact event ID; intersected with all other filters. */
	id?: string;
	type?: string;
	from?: Ref;
	conv?: Ref;
	agent?: string;
	since?: string;
	until?: string;
	after?: string;
	limit?: number;
}
export type { Preset, Profile, SessionModels } from "./models.js";
export interface EventPage {
	events: YEvent[];
	next?: string;
}
export interface SessionNotification {
	id: number;
	from: string;
	event: string;
	text: string;
}

interface SessionUpdateBase {
	session?: string;
	runId?: string;
	eventIds?: string[];
	type:
		| "snapshot"
		| "message"
		| "tool"
		| "state"
		| "error"
		| "end"
		| "inbox"
		| "notification"
		| "model.fallback"
		| "todo.updated";
	/** `end`: the run.end event. `model.fallback` / `todo.updated`: the event payload (contracts §3.3, §3.4). */
	event?: object;
	id?: string;
	message?: object;
	messages?: Array<{ id: string; message: object }>;
	items?: Array<{ id: string; message?: object; notification?: SessionNotification }>;
	notification?: SessionNotification;
	streaming?: boolean;
	running?: boolean;
	inputs?: string[];
	inbox?: Array<{ id: string; mode: string }>;
	tool?: { id: string; name: string; args?: object; phase: "start" | "update" | "end"; text?: string; result?: object };
	error?: string;
}
export type SessionUpdate =
	| SessionUpdateBase
	| (Omit<SessionUpdateBase, "type"> & { type: "event"; name: string; data: unknown });

export interface SessionsAPI {
	/** Deterministic model/status/compact commands, scoped to this session and its capabilities. */
	command(id: string, command: string): Promise<string>;
	notify(
		id: string,
		input: { event: string; text: string },
	): Promise<{ session: string; event: string; entry: number; recorded: true }>;
	list(filter: { agent?: string; mode?: Mode; open?: boolean }): Promise<SessionInfo[]>;
	get(id: string): Promise<SessionInfo | undefined>;
	open(req: {
		preset: string;
		parent?: string;
		capabilities?: Capability[];
		close?: "run-end" | "manual";
	}): Promise<SessionInfo>;
	/** Plugins may also submit system reminders to open main/persistent sessions, under their current profile. No human authority is implied. */
	submit(id: string, input: Input, opts: { wait: true; busy?: "followup" | "steer" | "interrupt" }): Promise<RunResult>;
	submit(
		id: string,
		input: Input,
		opts: { wait?: false; busy?: "followup" | "steer" | "interrupt" },
	): Promise<InputReceipt>;
	submit(
		id: string,
		input: Input,
		opts?: { wait?: boolean; busy?: "followup" | "steer" | "interrupt" },
	): Promise<RunResult | InputReceipt>;
	abort(id: string): Promise<void>;
	close(id: string): Promise<void>;
	/** `before` reads the newest `limit` items with id below it (returned ascending); it replaces `from`. */
	transcript(id: string, range?: { from?: number; limit?: number; before?: number }): Promise<TranscriptItem[]>;
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
	from?: string;
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
	multiAgent?: boolean;
	type: string;
	configSchema?: TSchema;
	create(id: string, config: unknown): Channel | Promise<Channel>;
}
export interface Channel {
	multiAgent?: boolean;
	id: string;
	kinds: string[];
	output: { stream: boolean; attachments: boolean };
	features?: ChannelFeatures;
	login?(action: "start" | "poll", signal: AbortSignal, verifyCode?: string): Promise<ChannelLoginResult>;
	start(io: ChannelIO): Promise<void>;
	stop(signal?: AbortSignal): Promise<void>;
	send(target: Ref, msg: OutMessage, signal?: AbortSignal): Promise<Delivery>;
	/** Optional native edit; unknown effects must not be retried. */
	edit?(target: Ref, id: string, msg: OutMessage, signal?: AbortSignal): Promise<Delivery>;
	stream?(conv: Ref, out: AsyncIterable<OutputPart>, replyTo?: string, signal?: AbortSignal): Promise<Delivery>;
}
export interface ChannelLoginResult {
	status: string;
	instance: string;
	qrcodeUrl?: string;
	expiresAt?: string;
	peer?: string;
	account?: Ref;
	person?: Ref | null;
	contextAvailable?: boolean;
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
	/** Stable delivery attempt identifier, reused on retry. */
	deliveryId?: string;
	notification?: NotificationIntent;
	text: string;
	/** Automatic reply source; explicit replyTo still forces a quoted reply. */
	sourceMessageId?: string;
	attachments?: Attachment[];
	replyTo?: string;
}
export interface Delivery {
	ok: boolean;
	/** Transient failure before any part was sent. Never combine with id or uncertain. */
	retryable?: boolean;
	uncertain?: boolean;
	id?: string;
	error?: string;
}
export type OutputPart =
	| { type: "message_start"; id: string }
	| { type: "message_end"; text: string }
	| { type: "text"; delta: string }
	| { type: "tool"; phase: "start" | "end"; name: string; label?: string; ok?: boolean }
	| { type: "final"; text: string }
	| { type: "error"; message: string };

export interface Tool {
	name: string;
	description: string;
	/** Guidance included only when this tool is offered to the model. */
	guidelines?: string[];
	parameters: TSchema;
	capabilities: Capability[];
	execute(args: unknown, ctx: ToolContext): Promise<ToolResult>;
}
export interface ToolContext {
	agent: string | null;
	profile: string;
	session: string;
	capabilities: Capability[];
	/** Effective scope from the real run configuration, not inferred from input events. */
	channelInstances?: string[];
	env: ExecutionEnv;
	event?: YEvent;
	/** Actual inputs of this native run, including placed steer inputs. */
	events?: YEvent[];
	signal: AbortSignal;
	cacheToolOutput?(text: string, options?: { extension?: string }): Promise<string>;
	/** Check the runtime file-write policy for a plugin mutation. */
	checkFileWrite?(path: string): Promise<void>;
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
	projectRules?: () => Promise<Array<{ path: string; content: string }>>;
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
	/** Filter a complete outbound message, including its destination Ref, before any channel attempt or ledger record. */
	beforeSend?(message: OutMessage & { to: Ref }, owner?: ExecutionOwner): HookResult<{ message: OutMessage }>;
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
/** Read-only host facts for setup guidance (`PluginAPI.host.status`); never carries secret values. */
export interface HostStatus {
	/** yonder.yaml `defaultModel` and the model the calling session resolves to. */
	model: { default?: string; session: string; known: boolean; authConfigured: boolean };
	channels: Array<{ instance: string; type: string; login: boolean }>;
	plugins: Array<{ id: string; use: string }>;
	/** Third-party channel plugins installed with this release but without an instance in yonder.yaml. */
	shippedChannels: Array<{ type: string; plugin: string }>;
	gateway: { enabled: boolean; port?: number };
	credentials: Array<{ provider: string; slot: string; configured: boolean }>;
}
export interface ServiceEndpoint {
	id: string;
	protocol: string;
	baseUrl: string;
	apiKey?: string;
	models: string[];
	voices?: string[];
}

export interface ExecutionOwner {
	session: string;
	agent: string | null;
	profile: string;
}

export interface ResolvedExecution {
	capabilities: Capability[];
	channelInstances?: string[];
}

/** Platform-neutral permission operations. Providers must never return credentials or infer grants. */
export interface PermissionRequest {
	provider: string;
	action: "status" | "request" | "guide" | "watch";
	kind: string;
	/** Seconds; provider may constrain supported actions/range. */
	timeout?: number;
}
export interface PermissionResponse {
	platform: string;
	/** Actual platform result, including responsible identity and raw permission states. Never normalized to granted. */
	result: unknown;
}
export interface PermissionProvider {
	/** Plugin id, or plugin id followed by a dot and local provider id. */
	id: string;
	scope: string;
	kinds: string[];
	invoke(request: PermissionRequest, ctx: ToolContext): Promise<PermissionResponse>;
}
export interface PermissionsAPI {
	register(provider: PermissionProvider): void;
	list(ctx: ToolContext): Promise<Array<Pick<PermissionProvider, "id" | "scope" | "kinds">>>;
	invoke(request: PermissionRequest, ctx: ToolContext): Promise<PermissionResponse>;
}
export interface PluginAPI extends PluginViewsAPI {
	social?: SocialAPI;
	permissions: PermissionsAPI;
	agents: { list(): Promise<{ id: string; name: string; avatarUrl?: string }[]> };
	readonly version: string;
	readonly locale: string;
	readonly timezone: string;
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
				notification?: NotificationIntent;
				signal?: AbortSignal;
				/** Program delivery on behalf of this stored execution owner; revalidated by core. */
				owner?: ExecutionOwner;
			},
			ctx?: ToolContext,
		): Promise<Delivery>;
	};
	execution: {
		resolve(owner: ExecutionOwner): Promise<ResolvedExecution>;
		run(request: {
			owner: ExecutionOwner;
			capabilities: Capability[];
			command: string | string[];
			cwd?: string;
			signal?: AbortSignal;
		}): Promise<{ stdout: string; stderr: string; exitCode: number }>;
	};
	credentials: { get(name: string): Promise<Credential | undefined> };
	sessions: SessionsAPI;
	subagents: { run(request: SubagentTaskRequest, ctx: ToolContext): Promise<ToolResult> };
	identity: IdentityAPI;
	services: { resolve(capability: string): Promise<ServiceEndpoint | undefined> };
	/** Read-only host facts. `status` needs an admin tool context; `modelReady` only says whether an agent's default model has auth. */
	host: { status(ctx: ToolContext): Promise<HostStatus>; modelReady(agent: string): Promise<boolean> };
	models: Models;
	paths: { data: string };
}
export interface PluginModule {
	setup(api: PluginAPI): void | Promise<void>;
	configSchema?: TSchema;
}
