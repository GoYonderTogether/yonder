import type { Hook, OutMessage, PluginAPI, ToolContext, YEvent } from "@yonder/sdk";
import { parseRef } from "@yonder/sdk";
import { Type } from "typebox";
import { Check } from "typebox/value";
import type { CardChannel } from "./channel.js";

const action = Type.Object(
	{ id: Type.String({ minLength: 1 }), label: Type.String({ minLength: 1 }), link: Type.Optional(Type.String()) },
	{ additionalProperties: false },
);
const parameters = Type.Object(
	{
		title: Type.String({ minLength: 1 }),
		body: Type.String(),
		actions: Type.Array(action),
		link: Type.Optional(Type.String()),
	},
	{ additionalProperties: false },
);

type ReplyCard = {
	title: string;
	body: string;
	actions: Array<{ id: string; label: string; link?: string }>;
	link?: string;
};
type Intent = ReplyCard & {
	state: "pending";
	session: string;
	agent: string;
	runId: string;
	sourceEventId: string;
	conv: string;
	msgId: string;
};
type BeforeSend = NonNullable<Hook["beforeSend"]>;
type Final = NonNullable<Parameters<BeforeSend>[2]>;
type Owner = NonNullable<Parameters<BeforeSend>[1]>;

const component = (value: string) => {
	if (!/^[A-Za-z0-9._-]+$/.test(value)) throw new Error("卡片只能在当前 Agent 运行中准备");
	return value;
};
const intentPath = (session: string, runId: string) => `replies/${component(session)}/${component(runId)}.json`;

function appLink(value: string | undefined): string | undefined {
	if (value === undefined) return undefined;
	if (
		!value.startsWith("/") ||
		value.startsWith("//") ||
		value.includes("\\") ||
		[...value].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
	)
		throw new Error("按钮链接必须是应用内绝对路径");
	try {
		if (new URL(value, "https://yonder.invalid").origin !== "https://yonder.invalid")
			throw new Error("按钮链接必须是应用内绝对路径");
	} catch {
		throw new Error("按钮链接必须是应用内绝对路径");
	}
	return value;
}

function sourceEvent(
	ctx: ToolContext,
	channels: Map<string, CardChannel>,
): { event: YEvent & { conv: string; from: string }; agent: string; runId: string } {
	const agent = ctx.agent;
	const runId = ctx.runId;
	if (!agent || !runId || !ctx.capabilities.includes("message")) throw new Error("需要当前 Agent 的真实消息运行权限");
	const currentConv = ctx.event?.type === "message.in" ? ctx.event.conv : undefined;
	if (!currentConv || !ctx.autoReplySource) throw new Error("当前运行没有可回复的入站消息来源");
	const events = ctx.events ?? [];
	const event = events.find((item) => item.id === ctx.autoReplySource);
	const latest = [...events].reverse().find((item) => item.type === "message.in" && item.conv === currentConv);
	if (event?.type !== "message.in" || event.conv !== currentConv || event !== latest || !event.from)
		throw new Error("当前运行没有可回复的入站消息来源");
	const conv = parseRef(event.conv);
	const from = parseRef(event.from);
	const data = event.data as { kind?: unknown; target?: unknown; msgId?: unknown };
	if (
		conv.kind !== "conv" ||
		from.kind !== "acct" ||
		conv.channel !== from.channel ||
		!channels.has(conv.channel) ||
		ctx.channelInstances?.includes(conv.channel) === false ||
		!conv.id.startsWith(`${agent}:`) ||
		!from.id.startsWith(`${agent}:`) ||
		data.target !== agent ||
		!(["dm", "group", "notice"] as unknown[]).includes(data.kind)
	)
		throw new Error("卡片只能回复当前 Agent 的 card 渠道消息");
	const route = event.routes?.find((item) => item.agent === agent && item.session === ctx.session);
	if (!route || route.dropped || route.waiting !== false) throw new Error("当前消息不在可自动回复的 card 会话中");
	if (typeof data.msgId !== "string" || !data.msgId) throw new Error("当前 card 消息没有可关联的平台消息 ID");
	return { event: { ...event, conv: event.conv, from: event.from }, agent, runId };
}

function cardData(input: unknown): ReplyCard {
	if (!Check(parameters, input)) throw new Error("卡片参数无效");
	const value = input as ReplyCard;
	const ids = new Set<string>();
	const actions = value.actions.map((item) => {
		if (ids.has(item.id)) throw new Error("卡片按钮 id 不能重复");
		ids.add(item.id);
		const link = appLink(item.link);
		return { id: item.id, label: item.label, ...(link === undefined ? {} : { link }) };
	});
	const link = appLink(value.link);
	return { title: value.title, body: value.body, actions, ...(link === undefined ? {} : { link }) };
}

function interactive(intent: Intent): NonNullable<OutMessage["content"]> {
	const {
		state: _state,
		session: _session,
		agent: _agent,
		runId: _runId,
		sourceEventId: _source,
		conv: _conv,
		msgId: _msgId,
		...card
	} = intent;
	return { type: "interactive", ...card, state: "pending" };
}

export function registerReplyCard(api: PluginAPI, channels: Map<string, CardChannel>): void {
	const files = () => api.storage.open();
	api.tools.register({
		name: "channel-card_reply_card",
		description:
			"Prepare one interactive final card for the current card conversation. Use each button's own application path. This only prepares the current reply; finish normally and do not send another message.",
		guidelines: [
			"When a request needs a device connection or client installation, prepare an interactive card with the relevant buttons instead of giving only a textual instruction.",
			"Use /connect for a device connection and /download for client installation; put each action's own application link on its button.",
			"This tool only prepares the current conversation's final card. Finish normally after preparation; do not send a second message to the same source or use NO_REPLY, and do not claim the card has already been delivered.",
		],
		capabilities: ["message"],
		parameters,
		async execute(input, ctx) {
			try {
				ctx.signal.throwIfAborted();
				const data = cardData(input);
				const current = sourceEvent(ctx, channels);
				const source = current.event;
				const path = intentPath(ctx.session, current.runId);
				const intent: Intent = {
					...data,
					state: "pending",
					session: ctx.session,
					agent: current.agent,
					runId: current.runId,
					sourceEventId: source.id,
					conv: source.conv,
					msgId: (source.data as { msgId: string }).msgId,
				};
				const storage = files();
				await storage.transaction(async (tx) => {
					await tx.mkdir(path.slice(0, path.lastIndexOf("/")));
					await tx.write(path, JSON.stringify(intent));
				});
				return { text: "交互卡片已准备，尚未发送。请正常结束本轮，不要再发送第二条消息。" };
			} catch (error) {
				return { isError: true, text: error instanceof Error ? error.message : "卡片准备失败" };
			}
		},
	});

	const remove = async (session: string, runId: string) => files().remove(intentPath(session, runId));
	const hook: Hook = {
		id: "channel-card-reply-card",
		async beforeSend(message, owner?: Owner, final?: Final) {
			if (final?.status !== "done" || !owner?.agent) return;
			let intent: Intent;
			try {
				const raw = await files().read(intentPath(owner.session, final.runId));
				if (!raw) return;
				intent = JSON.parse(raw) as Intent;
			} catch {
				return;
			}
			if (
				intent.state !== "pending" ||
				intent.session !== owner.session ||
				intent.agent !== owner.agent ||
				intent.runId !== final.runId ||
				intent.sourceEventId !== final.sourceEventId ||
				intent.conv !== message.to ||
				intent.msgId !== message.sourceMessageId
			)
				return;
			return {
				message: {
					...message,
					text: `${intent.title}${intent.body ? `\n\n${intent.body}` : ""}`,
					content: interactive(intent),
				},
			};
		},
	};
	api.hooks.register(hook);
	api.events.on("message.attempt", async (event) => {
		const data = event.data as {
			target?: unknown;
			session?: unknown;
			runId?: unknown;
			from?: unknown;
			outgoing?: OutMessage;
		};
		if (
			typeof data.session !== "string" ||
			typeof data.runId !== "string" ||
			typeof data.target !== "string" ||
			data.outgoing?.content?.type !== "interactive"
		)
			return;
		try {
			const path = intentPath(data.session, data.runId);
			const raw = await files().read(path);
			if (!raw) return;
			const intent = JSON.parse(raw) as Intent;
			if (
				intent.conv === data.target &&
				intent.agent &&
				data.from === `agent:${intent.agent}` &&
				data.outgoing?.sourceMessageId === intent.msgId &&
				JSON.stringify(data.outgoing?.content) === JSON.stringify(interactive(intent))
			)
				await files().remove(path);
		} catch {
			api.log.warn("Prepared card cleanup failed");
		}
	});
	api.events.on("run.end", async (event) => {
		const data = event.data as { session?: unknown; runId?: unknown; status?: unknown };
		if (data.status === "done" || typeof data.session !== "string" || typeof data.runId !== "string") return;
		try {
			await remove(data.session, data.runId);
		} catch {
			api.log.warn("Prepared card cleanup failed");
		}
	});
}
