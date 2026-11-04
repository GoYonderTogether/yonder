import { hostname } from "node:os";
import { type HarnessService, harnessSession, harnessTranscriptPage } from "./adapter.js";
import { BotBridge, type BotRegistration } from "./bots.js";
import { CloudConnection, cloudUrl } from "./connection.js";
import { watchEvent } from "./event-stream.js";
import { parseFrame } from "./frames.js";
import { type ConnectorState, clearStateDir, readConfig, readState, stateDir, writeState } from "./state.js";
import { WorkBridge } from "./work.js";

/** Plugin name shown by the harness Loader. */
export const name = "yonder-connector";
/**
 * `tools` is the only hard dependency (the status tool). The session API and preset
 * registry are picked up through dynamic injection, so a harness without them starts
 * normally and keeps the status tool (spec 23 §4: degrade, never fail startup).
 */
const INJECT = ["tools"];
export const inject = INJECT;

export interface Config {
	/** Cloud origin; defaults to the public site. */
	endpoint?: string;
	/** Override the state directory; defaults to `$DSH_HOME/yonder`. */
	stateDir?: string;
	/** Skip the background connection and register only the status tool. */
	toolsOnly?: boolean;
}

const DEFAULT_ENDPOINT = "https://yonderbot.net";

/** Services the background connection needs; DSH provides them in a web-backed profile. */
const SERVICES = ["sessionController", "agentPresets"] as const;

export interface PresetRow {
	id: string;
	name?: string;
	description?: string;
}

/** The subset of DSH's context this plugin uses, kept structural so the connector needs no DSH types. */
export interface DshContext {
	/** Resolve an injected service; a service this plugin did not declare reads as absent. */
	get?<T>(name: string): T | undefined;
	/** Services this plugin declares; DSH then exposes them on the context. */
	tools?: ToolRegistry;
	inject?(names: string[], callback: (child: DshContext) => void): void;
	on?(event: "session/event", listener: (session: { id: string }, event: unknown) => void): () => void;
	effect?(setup: () => () => void): void;
	logger?(scope: string): { warn(message: string): void; info?(message: string): void };
	/** Resolved at runtime by DSH; declared structurally for the plugin body. */
	readonly config?: Config;
}

interface ToolRegistry {
	register(tool: unknown): () => void;
}

interface SessionApi {
	list(request: { cursor?: string }, signal: AbortSignal): Promise<{ items: unknown[] }>;
	page(
		request: {
			address: { kind: "session"; sessionId: string };
			/** Required by DSH; must not exceed the session cursor. */
			throughSeq: number;
			beforeSeq?: number;
			maxMessages?: number;
		},
		signal: AbortSignal,
	): Promise<{ records: unknown[]; hasMore: boolean }>;
	/** Current log cursor for one session (DSH's sequenced projection baseline). */
	projections(request: { sessionId: string }, signal: AbortSignal): Promise<{ kind?: string; asOfSeq?: number } | null>;
	create(request: { cwd?: string; agentPreset?: string }, signal: AbortSignal): Promise<{ sessionId: string }>;
	prompt(
		request: {
			requestId: string;
			sessionId: string;
			mode: "queue" | "steer";
			content: Array<{ type: "text"; text: string }>;
		},
		signal: AbortSignal,
	): Promise<{ accepted: true }>;
	cancel(request: { sessionId: string }): Promise<{ accepted: true }>;
	follow(
		request: { address: { kind: "session"; sessionId: string } },
		signal: AbortSignal,
	): AsyncIterable<
		| { type: "snapshot"; cursor: number; records: Array<{ event: HarnessEventWire }> }
		| { type: "event"; event: HarnessEventWire }
		| { type: "assistant-stream"; frame: { type: string; chunk?: unknown } }
	>;
}

interface HarnessEventWire {
	seq: number;
	type: string;
	time: number;
	data: unknown;
}

interface PresetApi {
	readonly defaultId: string;
	list(): Promise<PresetRow[]>;
}

/** Adapt DSH's session controller to the connector's narrow interface. */
export function dshHarness(sessions: SessionApi, presets: PresetApi): HarnessService {
	return {
		async list(signal) {
			const page = await sessions.list({}, signal);
			return page.items.flatMap((row) => {
				const session = harnessSession(row);
				return session ? [session] : [];
			});
		},
		async show(id, signal) {
			const page = await sessions.list({}, signal);
			return harnessSession(page.items.find((item) => (item as { sessionId?: unknown }).sessionId === id));
		},
		async transcript(id, range, signal) {
			// DSH requires an explicit cut at or below the session cursor; `throughSeq: -1` would be
			// an empty page, so a missing cut reads the current baseline first.
			const cut = await logCut(sessions, id, signal);
			if (cut === undefined) return { items: [], hasMore: false };
			const page = await sessions.page(
				{
					address: { kind: "session", sessionId: id },
					throughSeq: cut,
					...(range.before === undefined ? {} : { beforeSeq: range.before }),
					maxMessages: range.limit,
				},
				signal,
			);
			return harnessTranscriptPage(page);
		},
		async create(options, signal) {
			const created = await sessions.create(
				{ ...(options.cwd ? { cwd: options.cwd } : {}), agentPreset: options.preset ?? presets.defaultId },
				signal,
			);
			return { sessionId: created.sessionId };
		},
		async submit(id, text, signal) {
			const accepted = await sessions.prompt(
				{
					requestId: `yonder-${Date.now()}-${Math.random().toString(36).slice(2)}`,
					sessionId: id,
					mode: "queue",
					content: [{ type: "text", text }],
				},
				signal,
			);
			return { accepted: accepted.accepted };
		},
		async abort(id) {
			await sessions.cancel({ sessionId: id });
		},
		async follow(id, onUpdate, signal) {
			return watchEvent(sessions, id, onUpdate, signal);
		},
		defaultPreset() {
			return presets.defaultId;
		},
	};
}

/** The included log cut for one session, or undefined when DSH has no baseline yet. */
async function logCut(sessions: SessionApi, id: string, signal: AbortSignal): Promise<number | undefined> {
	const baseline = await sessions.projections({ sessionId: id }, signal);
	return typeof baseline?.asOfSeq === "number" ? baseline.asOfSeq : undefined;
}

/** Register the connector: background connection, Bot registration, and one status tool. */
export function apply(ctx: DshContext, config: Config = {}): void {
	const endpoint = config.endpoint?.trim() || DEFAULT_ENDPOINT;
	try {
		cloudUrl(endpoint);
	} catch {
		registerStatus(ctx, async () => "未连接：Yonder 服务地址无效。");
		log(ctx, "Yonder 服务地址无效，连接器只提供状态工具。");
		return;
	}
	const dir = config.stateDir ?? stateDir();
	const stored = safeConfig(dir);
	if (!stored) {
		registerStatus(ctx, async () => "未连接 Yonder：在终端或让我运行 `npx -y @yonder/connect dsh` 完成安装。");
		return;
	}
	if (config.toolsOnly) {
		registerStatus(ctx, async () => `已配置 ${stored.endpoint}，当前为仅工具模式（未建立后台连接）。`);
		return;
	}
	ctx.effect?.(() => start(ctx, stored.endpoint, stored.deviceToken, dir));
}

/** The whole live connector; returns its disposal. */
function start(ctx: DshContext, endpoint: string, deviceToken: string, dir: string): () => void {
	let state = readState(dir);
	const persist = (next: ConnectorState) => {
		state = next;
		try {
			writeState(dir, next);
		} catch {
			// A read-only harness home must not take DSH down; this run still works from memory.
		}
	};
	const host = hostname();
	let presets: PresetRow[] = [];
	let bots: BotBridge | undefined;
	let work: WorkBridge | undefined;
	let connection: CloudConnection | undefined;
	let hello = false;
	let stopped = false;

	registerStatus(ctx, async () => {
		const count = bots?.botAgents.length ?? 0;
		return `${connection?.connected ? "已连接" : "未连接"} ${endpoint}；已登记 Bot ${count} 个。`;
	});

	// Dynamic injection: DSH resolves these services after the profile has composed them.
	ctx.inject?.([...SERVICES], (child) => {
		if (stopped) return;
		const sessions = child.get?.<SessionApi>("sessionController");
		const presetApi = child.get?.<PresetApi>("agentPresets");
		if (!sessions || !presetApi) {
			log(ctx, "DSH 的会话服务不可用，连接器只提供状态工具。");
			return;
		}
		const connector = new CloudConnection({
			endpoint,
			deviceToken,
			onFrame: (raw) => {
				const frame = parseFrame(raw);
				if (!frame) return;
				// hello announces work capability only after the session methods exist (spec 23 §2.1).
				if (frame.type === "message" || frame.type === "sent" || frame.type === "error") {
					bots?.handle(frame);
					return;
				}
				work?.handle(frame);
			},
			onOpen: () => {
				if (hello) return;
				hello = true;
				connector.send({ type: "hello", workProtocol: 1 });
			},
			onClose: (reason) => {
				hello = false;
				log(ctx, `Yonder 连接断开（${reason}），正在重连。`);
			},
		});
		connection = connector;
		const harness = dshHarness(sessions, presetApi);
		const agents = (): BotRegistration[] =>
			presets.map((preset, index) => ({
				key: preset.id,
				name: preset.name ?? (index === 0 ? host : `${host} · ${preset.id}`),
			}));
		bots = new BotBridge({
			harness,
			connection: connector,
			api: { putAgents: (list) => putAgents(endpoint, deviceToken, list) },
			agents,
			onAck: (agentId, convId, seq) => {
				const key = `${agentId}:${convId}`;
				if (seq <= (state.cursors[key] ?? 0)) return;
				persist({ ...state, cursors: { ...state.cursors, [key]: seq } });
			},
			cursor: (agentId, convId) => state.cursors[`${agentId}:${convId}`],
			bindSession: (key, sessionId) => persist({ ...state, botSessions: { ...state.botSessions, [key]: sessionId } }),
			sessionFor: (key) => state.botSessions[key],
			unbindSession: (key) => {
				const next = { ...state.botSessions };
				delete next[key];
				persist({ ...state, botSessions: next });
			},
			log: (message) => log(ctx, message),
		});
		work = new WorkBridge(harness, connector, host, host);

		// Replies leave the harness through the socket the request arrived on.
		child.on?.("session/event", (session, event) => {
			if (stopped) return;
			const row = event as { seq?: unknown; type?: unknown; data?: unknown };
			void bots
				?.onHarnessEvent({
					sessionId: session.id,
					seq: typeof row.seq === "number" ? row.seq : 0,
					type: typeof row.type === "string" ? row.type : "unknown",
					data: row.data,
					time: Date.now(),
				})
				.catch(() => {});
		});

		void (async () => {
			presets = await presetApi.list().catch(() => []);
			if (stopped) return;
			await bots?.start().catch(() => {});
		})();
	});

	return () => {
		stopped = true;
		bots?.stop();
		work?.stop();
		connection?.stop();
	};
}

/** `PUT /api/device/agents`: the harness's complete agent list, reconciled by the cloud (spec 23 §2.2). */
async function putAgents(
	endpoint: string,
	deviceToken: string,
	agents: Array<{ key: string; name: string; avatarUrl: string | null }>,
): Promise<Array<{ key: string; id: string }>> {
	const response = await fetch(new URL("/api/device/agents", endpoint), {
		method: "PUT",
		redirect: "error",
		headers: { authorization: `Bearer ${deviceToken}`, "content-type": "application/json" },
		body: JSON.stringify(agents),
		signal: AbortSignal.timeout(15_000),
	});
	if (!response.ok) throw new Error(`Bot registration failed (HTTP ${response.status})`);
	const body: unknown = await response.json();
	if (!Array.isArray(body)) throw new Error("Bot registration returned an invalid body");
	return body.flatMap((row) => {
		const item = row as { key?: unknown; id?: unknown };
		return typeof item.key === "string" && typeof item.id === "string" ? [{ key: item.key, id: item.id }] : [];
	});
}

/** The single model-facing tool: connection status. Read-only, no session access. */
function registerStatus(ctx: DshContext, read: () => Promise<string>): void {
	try {
		ctx.tools?.register(statusTool(read));
	} catch {
		// A harness without a tool registry still gets the connection; only the status tool is lost.
	}
}

function statusTool(read: () => Promise<string>) {
	return {
		name: "yonder_status",
		description: "Report whether this harness is connected to a Yonder account and how many Bots it registered.",
		parameters: { type: "object", properties: {}, additionalProperties: false },
		output: {
			schema: { type: "object", properties: { status: { type: "string" } }, additionalProperties: false },
			render: (_args: unknown, value: { status: string }) => [{ type: "text", text: value.status }],
		},
		async execute() {
			return { status: await read() };
		},
	};
}

function log(ctx: DshContext, message: string): void {
	try {
		(ctx.logger?.("yonder-connector") as { warn?(message: string): void } | undefined)?.warn?.(message);
	} catch {
		/* Logging must never break the connector. */
	}
}

/** Read the stored config; an unreadable file is reported as "not connected" rather than thrown. */
function safeConfig(dir: string): { endpoint: string; deviceToken: string } | undefined {
	try {
		return readConfig(dir);
	} catch {
		return undefined;
	}
}

/** The "disconnect" action: remove this connector's state files (spec 23 §6). */
export function disconnect(dir = stateDir()): string[] {
	return clearStateDir(dir);
}
