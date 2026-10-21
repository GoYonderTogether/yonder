import { randomUUID } from "node:crypto";
import type {
	AskResult,
	Attachment,
	EventInput,
	Preset,
	SessionInfo,
	Tool,
	ToolContext,
	ToolResult,
	YEvent,
} from "@yonder/sdk";
import { Type } from "typebox";
import { type AgentConfig, resolveProfile } from "../config/index.js";
import type { DeliveryService } from "../delivery/index.js";
import type { Runtime, RuntimeInput } from "../runtime/index.js";
import type { Sessions } from "../sessions/index.js";
import type { Store } from "../store/index.js";
import { coreToolCapabilities } from "./catalog.js";
import { MAX_SOURCES, sourceBlock } from "./sources.js";

interface CoreToolsOptions {
	store: Store;
	agents: Map<string, AgentConfig>;
	sessions: Sessions;
	runtime: () => Runtime;
	delivery: DeliveryService;
	ask(input: EventInput): Promise<AskResult>;
	getPreset(id: string): Preset | undefined;
	presets?: () => Preset[];
}
const result = (value: unknown): ToolResult => ({ text: typeof value === "string" ? value : JSON.stringify(value) });
const fail = (error: unknown): ToolResult => ({
	text: error instanceof Error ? error.message : String(error),
	isError: true,
});
const text = () => Type.String({ minLength: 1 });
const schema = (fields: Record<string, import("typebox").TSchema>) =>
	Type.Object(fields, { additionalProperties: false });
const effortSchema = Type.Optional(text());
const sourcesSchema = Type.Optional(Type.Array(text(), { minItems: 1, maxItems: MAX_SOURCES }));
const attachmentSchema = Type.Object(
	{
		kind: Type.Union([Type.Literal("image"), Type.Literal("audio"), Type.Literal("video"), Type.Literal("file")]),
		mime: text(),
		uri: text(),
		name: Type.Optional(text()),
		bytes: Type.Optional(Type.Number({ minimum: 0 })),
	},
	{ additionalProperties: false },
);
function requireCapability(ctx: ToolContext, capability: "admin" | "cross-agent" | "message" | "read") {
	if (!ctx.capabilities.includes(capability)) throw new Error(`需要 ${capability} 能力。`);
}

async function withSignal<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
	signal.throwIfAborted();
	let aborted: (() => void) | undefined;
	const cancellation = new Promise<never>((_resolve, reject) => {
		aborted = () => reject(signal.reason ?? new Error("工具调用已中止。"));
		signal.addEventListener("abort", aborted, { once: true });
	});
	try {
		return await Promise.race([work, cancellation]);
	} finally {
		if (aborted) signal.removeEventListener("abort", aborted);
	}
}

export function createCoreTools(options: CoreToolsOptions): Tool[] {
	const { store, agents, sessions, runtime, delivery, ask, getPreset } = options;
	const tool = (definition: Omit<Tool, "capabilities">): Tool => ({
		capabilities: coreToolCapabilities[definition.name]!,
		...definition,
		execute: async (args, ctx) => {
			try {
				ctx.signal.throwIfAborted();
				return await definition.execute(args, ctx);
			} catch (error) {
				return fail(error);
			}
		},
	});
	const sameAgent = (session: SessionInfo, ctx: ToolContext) => {
		if (session.agent !== ctx.agent) requireCapability(ctx, "cross-agent");
	};
	/** Verbatim copies of inbound messages of this run's own conversation; the model never re-types them. */
	async function quoteSources(ids: string[] | undefined, ctx: ToolContext): Promise<string | undefined> {
		if (!ids?.length) return undefined;
		const conv = ctx.event?.conv;
		if (!conv) throw new Error("sources 只能引用本次运行来源会话里的入站消息，当前运行没有来源会话。");
		const events: YEvent[] = [];
		for (const id of ids) {
			const event: YEvent | undefined =
				(await store.events.get(id)) ??
				(await store.events.findInput({ type: "message.in", conv, data: { msgId: id } } as EventInput));
			if (!event || event.type !== "message.in" || event.conv !== conv)
				throw new Error(`来源消息不存在或不属于本次运行的来源会话：${id}`);
			events.push(event);
		}
		return sourceBlock(events, conv);
	}
	async function taskInput(
		childId: string,
		presetId: string,
		task: string,
		attachments: Attachment[] | undefined,
		ctx: ToolContext,
		effort?: string,
	): Promise<{ session: SessionInfo; event: YEvent; input: RuntimeInput }> {
		const selected = getPreset(presetId);
		if (!selected) throw new Error(`未知预设：${presetId}`);
		const parent = await runtime().sessionConfig(ctx.session);
		const resolved = resolveProfile(selected, {}, parent.resolved.env);
		const capabilities = resolved.capabilities.filter((capability) => ctx.capabilities.includes(capability));
		let session = await store.sessions.get(childId);
		if (!session) {
			session = {
				id: childId,
				agent: null,
				profile: presetId,
				mode: "task",
				key: randomUUID(),
				parent: ctx.session,
				version: sessions.version,
				opened: new Date().toISOString(),
			};
			await store.sessions.put(session);

			await store.events.record({
				type: "session.open",
				...(ctx.agent ? { from: `agent:${ctx.agent}` } : {}),
				...(ctx.event ? { parent: ctx.event.id } : {}),
				data: { session: childId, mode: "task", key: session.key, profile: presetId },
			});
		}
		if (!(await runtime().sessionState(childId))?.profile)
			await runtime().setSessionState(childId, {
				agent: null,
				profile: presetId,
				cwd: parent.cwd,
				env: resolved.env,
				capabilities,
			});
		let event: YEvent | undefined;
		// Replay-safe task tools reacquire the prior input event for their existing owned conversation.
		let after: string | undefined;
		do {
			const page = await store.events.query({ type: "session.input", limit: 1000, ...(after ? { after } : {}) });
			event = page.events.find((event) => (event.data as { session?: string }).session === childId);
			after = page.next;
		} while (!event && after);
		event ??= await store.events.record({
			type: "session.input",
			...(ctx.agent ? { from: `agent:${ctx.agent}` } : {}),
			...(ctx.event ? { parent: ctx.event.id } : {}),
			data: {
				session: childId,
				text: task,
				waiting: true,
				busy: "followup",
				taskOwned: true,
				...(effort !== undefined ? { effort } : {}),
				...(attachments?.length ? { attachments } : {}),
			},
		});
		return { session, event, input: { text: task, event, ...(attachments ? { attachments } : {}) } };
	}
	return [
		tool({
			name: "message_send",
			description:
				"向明确的收件人或渠道发送消息。replyTo 可用目标消息头的 turn id 或 message 原生 ID，内核核实会话并转换。最终回复会自动交回来源或调用方；子任务不要用本工具向父 Agent 回传结果。",
			parameters: schema({
				to: Type.String({
					minLength: 1,
					description:
						"已核实的投递目标：owner（仅常驻 Agent）、person:<id>、acct:<渠道实例>:<id> 或 conv:<渠道实例>:<id>。from 中的 agent:<id>、acct:agent:<id> 是内部来源身份，session:<id> 是会话标识，不能当作投递地址。",
				}),
				via: Type.Optional(text()),
				text: Type.String(),
				replyTo: Type.Optional(text()),
				attachments: Type.Optional(Type.Array(attachmentSchema)),
			}),
			execute: async (args, ctx) => {
				const sent = await delivery.sendTool(ctx, args as Parameters<DeliveryService["sendTool"]>[1]);
				return { ...result(sent), ...(!sent.ok ? { isError: true } : {}) };
			},
		}),
		tool({
			name: "parent_ask",
			description:
				"向所属 Agent 的主会话请求代查或执行你无权完成的工作。仅分身可用；真实来源自动附上，请求不等于主人授权。15秒未完成返回后台句柄，实际结果自动送回；取得结果后再决定是否对群公开。",
			parameters: schema({ text: text() }),
			execute: async (args, ctx) => {
				const session = await store.sessions.get(ctx.session);
				if (!ctx.agent || !session || session.agent !== ctx.agent || session.mode === "main")
					throw new Error("parent_ask 仅供常驻 Agent 的非 main 分身请求所属主会话。");
				const events = ctx.events ?? (ctx.event ? [ctx.event] : []);
				const origins: YEvent[] = [];
				for (const event of events) {
					const sources = (event.data as { sourceEvents?: string[] }).sourceEvents;
					if (!sources) {
						origins.push(event);
						continue;
					}
					for (const id of sources) {
						const source = await store.events.get(id);
						if (source && source.conv === event.conv) origins.push(source);
					}
				}
				const reply = await withSignal(
					ask({
						type: "message.in",
						from: `acct:agent:${ctx.agent}`,
						conv: `conv:agent:${ctx.agent}`,
						...(ctx.event ? { parent: ctx.event.id } : {}),
						data: {
							kind: "parent-request",
							target: ctx.agent,
							text: (args as { text: string }).text,
							msgId: `parent:${runtime().invocationId(ctx)}`,
							requestOrigin: {
								session: session.id,
								profile: session.profile,
								events: origins.map((event) => ({ id: event.id, from: event.from, conv: event.conv })),
							},
						},
					}),
					ctx.signal,
				);
				const answer = reply.results.find((answer) => answer.agent === ctx.agent);
				if (!answer) throw new Error("所属 Agent 没有接收 parent-request 的 main 绑定。");
				return {
					...result({ status: answer.status, session: answer.session, text: answer.text, reason: answer.reason }),
					...(answer.status === "done" ? {} : { isError: true }),
				};
			},
		}),
		tool({
			name: "agent_ask",
			description:
				"通过目标 agent 的绑定提交问题；15秒未完成返回后台句柄，答复完成后自动通知。sources 填本次来源会话里入站消息的事件 id 或原生 id，由程序逐字附上原文（不要自己转述用户的话）；effort 指定被委派方本次运行的思考等级（需要 admin）。",
			parameters: schema({ agent: text(), text: text(), sources: sourcesSchema, effort: effortSchema }),
			execute: async (args, ctx) => {
				requireCapability(ctx, "message");
				if (!ctx.agent) throw new Error("预设会话没有 agent 身份，不能调用 agent_ask。");
				const request = args as { agent: string; text: string; sources?: string[]; effort?: string };
				if (!agents.has(request.agent)) throw new Error(`未知 agent：${request.agent}`);
				if (request.agent === ctx.agent) throw new Error("agent_ask 调用形成环。");
				let current = ctx.event;
				while (current) {
					const data = current.data as { target?: string };
					if (current.conv?.startsWith("conv:agent:")) {
						const origin = current.from?.startsWith("acct:agent:")
							? current.from.slice("acct:agent:".length)
							: undefined;
						if (origin === request.agent || data.target === request.agent) throw new Error("agent_ask 调用形成环。");
					}
					current = current.parent ? await store.events.get(current.parent) : undefined;
				}
				if (request.effort !== undefined) requireCapability(ctx, "admin");
				const quoted = await quoteSources(request.sources, ctx);
				const reply = await withSignal(
					ask({
						type: "message.in",
						from: `acct:agent:${ctx.agent}`,
						conv: `conv:agent:${ctx.agent}`,
						...(ctx.event ? { parent: ctx.event.id } : {}),
						data: {
							kind: "agent",
							text: quoted ? `${request.text}\n\n${quoted}` : request.text,
							...(request.sources?.length ? { sources: request.sources } : {}),
							...(request.effort !== undefined ? { effort: request.effort } : {}),
							target: request.agent,
							msgId: `internal:${runtime().invocationId(ctx)}`,
						},
					}),
					ctx.signal,
				);
				const answer = reply.results.find((answer) => answer.agent === request.agent);
				if (!answer) throw new Error("目标 agent 不接收你的消息。");
				return {
					...result(answer.text || answer.reason || answer.status),
					...(answer.status === "done" ? {} : { isError: true }),
				};
			},
		}),
		tool({
			name: "task_continue",
			description:
				"将已获授权任务的具体下一步排入本会话；接纳后可以结束阶段汇报，后续会自动执行。后台工具已有完成通知时不要重复安排等待。",
			parameters: schema({ text: text() }),
			execute: async (args, ctx) => {
				if (await runtime().hasOtherBackgroundWork(ctx))
					throw new Error(
						"Background work already delivers the next input automatically. Do not queue a continuation or repeat the delegation; finish this progress report and wait for its result.",
					);
				const key = runtime().invocationId(ctx);
				const origin = ctx.event;
				const text = (args as { text: string }).text;
				const event = await store.events.record(
					{
						type: "runtime.continuation",
						...(origin ? { parent: origin.id, conv: origin.conv } : {}),
						data: { session: ctx.session, job: key, text, waiting: false },
					},
					origin?.routes?.filter((route) => route.session === ctx.session) ?? [],
				);
				await runtime().enqueue(ctx.session, {
					text,
					event,
					wake: "run",
					busy: "followup",
					requestId: `continuation:${key}`,
				});
				return result("Next step durably accepted. Finish this progress report; the next step runs automatically.");
			},
		}),
		tool({
			name: "task_run",
			description: `使用预设完成专门任务；15秒未完成返回后台句柄，完成后自动通知。sources 由程序逐字附上本次来源会话的入站原文，effort 指定本次任务思考等级（需要 admin）。${(options.presets?.() ?? []).map((preset) => `${preset.id}: ${preset.description}`).join("；")}`,
			parameters: schema({
				preset: text(),
				task: text(),
				sources: sourcesSchema,
				effort: effortSchema,
				attachments: Type.Optional(Type.Array(attachmentSchema)),
			}),
			execute: async (args, ctx) => {
				const request = args as {
					preset: string;
					task: string;
					sources?: string[];
					effort?: string;
					attachments?: Attachment[];
				};
				await runtime().authorizeAttachments(ctx, request.attachments);
				if (!getPreset(request.preset)) throw new Error(`未知预设：${request.preset}`);
				if (request.effort !== undefined) requireCapability(ctx, "admin");
				const quoted = await quoteSources(request.sources, ctx);
				const task = quoted ? `${request.task}\n\n${quoted}` : request.task;
				const run = await runtime().runTask(ctx, async (childId) => {
					try {
						return (await taskInput(childId, request.preset, task, request.attachments, ctx, request.effort)).input;
					} catch (error) {
						if (await store.sessions.get(childId)) await sessions.closeSession(childId, "admission-error");
						throw error;
					}
				});
				return {
					...result({
						session: run.session,
						status: run.status,
						text: run.text,
						...(run.reason ? { reason: run.reason } : {}),
						...(run.attachments?.length ? { attachments: run.attachments } : {}),
					}),
					...(run.attachments?.length ? { attachments: run.attachments } : {}),
					...(run.status === "done" ? {} : { isError: true }),
				};
			},
		}),
		tool({
			name: "session_list",
			description: "列出本 agent 的会话；查看其他 agent 需要 cross-agent 能力。",
			parameters: schema({
				agent: Type.Optional(text()),
				mode: Type.Optional(
					Type.Union([
						Type.Literal("main"),
						Type.Literal("persistent"),
						Type.Literal("ephemeral"),
						Type.Literal("task"),
					]),
				),
				open: Type.Optional(Type.Boolean()),
			}),
			execute: async (args, ctx) => {
				requireCapability(ctx, "admin");
				const filter = args as { agent?: string; mode?: SessionInfo["mode"]; open?: boolean };
				if (filter.agent && filter.agent !== ctx.agent) requireCapability(ctx, "cross-agent");
				const rows = await sessions.api.list({
					...filter,
					...(!filter.agent && ctx.agent ? { agent: ctx.agent } : {}),
				});
				return result(rows.filter((row) => ctx.capabilities.includes("cross-agent") || row.agent === ctx.agent));
			},
		}),
		tool({
			name: "session_read",
			description: "读取会话转录。跨 agent 读取还需要 cross-agent 能力。",
			parameters: schema({
				session: text(),
				from: Type.Optional(Type.Integer({ minimum: 0 })),
				limit: Type.Optional(Type.Integer({ minimum: 1 })),
			}),
			execute: async (args, ctx) => {
				requireCapability(ctx, "admin");
				const request = args as { session: string; from?: number; limit?: number };
				const target = await sessions.api.get(request.session);
				if (!target) throw new Error("会话不存在。");
				sameAgent(target, ctx);
				return result(
					await sessions.api.transcript(request.session, {
						...(request.from !== undefined ? { from: request.from } : {}),
						...(request.limit !== undefined ? { limit: request.limit } : {}),
					}),
				);
			},
		}),
		tool({
			name: "identity_lookup",
			description: "查询本轮发送者的关联账号和会话；查询其他引用需要 admin，其他 agent 的信息需要 cross-agent。",
			parameters: schema({ ref: Type.Optional(text()) }),
			execute: async (args, ctx) => {
				requireCapability(ctx, "read");
				const ref = (args as { ref?: string }).ref ?? ctx.event?.from;
				if (!ref) throw new Error("本轮没有可查询的发送者，请指定引用。");
				if (ref !== ctx.event?.from) requireCapability(ctx, "admin");
				const found = await store.identity().lookup(ref);
				if (ctx.capabilities.includes("cross-agent")) return result(found);
				const convs = new Set<string>();
				if (ctx.agent)
					for (const account of found.accounts) {
						let after: string | undefined;
						do {
							const page = await store.events.query({
								from: account.ref,
								agent: ctx.agent,
								limit: 1000,
								...(after ? { after } : {}),
							});
							for (const event of page.events)
								if (
									event.conv &&
									event.routes?.some((route) => route.agent === ctx.agent && route.session && !route.dropped)
								)
									convs.add(event.conv);
							after = page.next;
						} while (after);
					}
				return result({
					accounts: found.accounts,
					convs: [...convs],
					agents: found.agents.filter((agent) => agent === ctx.agent),
				});
			},
		}),
		tool({
			name: "identity_link",
			description: "显式关联账号与人，或解除关联；写入 identity.link 事件。",
			parameters: schema({ account: text(), person: Type.Optional(text()), linked: Type.Optional(Type.Boolean()) }),
			execute: async (args, ctx) => {
				requireCapability(ctx, "admin");
				const request = args as { account: string; person?: string; linked?: boolean };
				const identity = store.identity(ctx.agent ? `agent:${ctx.agent}` : undefined);
				if (request.linked === false) await identity.unlink(request.account);
				else {
					if (!request.person) throw new Error("关联账号必须指定 person: 引用。");
					await identity.link(request.account, request.person);
				}
				return result({ ok: true });
			},
		}),
	];
}
