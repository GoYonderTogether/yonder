import type { TranscriptItem } from "../api/types";

// 把内核两种形态（分页读的 TranscriptItem、实时流的 pi Message）统一成界面用的 ChatItem。
export interface ToolCall {
	id: string;
	name: string;
	args?: unknown;
	result?: string;
	isError?: boolean;
	done: boolean;
}
export interface ChatItem {
	id: string;
	role: "user" | "assistant" | "summary" | "notice" | "tool-result";
	text: string;
	thinking?: string;
	tools: ToolCall[];
	/** 用户消息的来源渠道（<turn channel="…"> 或内核给的 channel），无则是本机控制台 */
	channel?: string;
	/** 发送者显示名，仅在内核提供 fromName 时存在（T-API-19） */
	fromName?: string;
	from?: string;
	streaming?: boolean;
	ts?: number;
	conv?: string;
	triggered?: boolean;
	owner?: boolean;
	metadata?: Array<{ label: string; text: string; offset: number }>;
}

interface Block {
	type: string;
	text?: string;
	thinking?: string;
	id?: string;
	name?: string;
	arguments?: unknown;
}
interface PiMessage {
	role: string;
	content: string | Block[];
	toolCallId?: string;
	isError?: boolean;
	summary?: string;
	/** T-API-19：session.update 的消息项可带来源渠道与发送者名；没有就不猜。 */
	channel?: string;
	fromName?: string;
	timestamp?: number;
}

const TURN = /^<turn\b([^>]*)>[\s\S]*?<\/turn>\s*/;

export function splitTurn(text: string): { body: string; channel?: string } {
	const m = TURN.exec(text);
	if (!m) return { body: text };
	return { body: text.slice(m[0].length), channel: /channel="([^"]*)"/.exec(m[1] ?? "")?.[1] };
}

/** Only runtime-owned leading wrappers are metadata; XML in the user's body stays intact. */
export function inputDetails(text: string, original?: string) {
	const metadata: NonNullable<ChatItem["metadata"]> = [];
	let body = text;
	const clock = /^<runtime_clock\b[^>]*>[\s\S]*?<\/runtime_clock>\s*/.exec(body);
	if (clock) {
		metadata.push({ label: "运行时钟", text: clock[0].trim(), offset: 0 });
		body = body.slice(clock[0].length);
	}
	const turn = TURN.exec(body);
	if (turn) {
		metadata.push({ label: "消息来源", text: turn[0].trim(), offset: 0 });
		body = body.slice(turn[0].length);
	}
	if (original !== undefined && body.startsWith(original)) {
		const suffix = body.slice(original.length).trim();
		if (suffix) metadata.push({ label: "上下文注入", text: suffix, offset: original.length });
		body = original;
	} else if (original !== undefined) {
		if (body.trim()) metadata.push({ label: "准备后的输入", text: body, offset: 0 });
		body = original;
	}
	const attr = (name: string) => new RegExp(`${name}="([^"]*)"`).exec(turn?.[1] ?? "")?.[1];
	const from = /^from: .*?\(([^,)]+)(?:,|\))/m.exec(turn?.[0] ?? "")?.[1];
	const eventType = attr("type");
	const fromName = /^from: (.*?) \(/m.exec(turn?.[0] ?? "")?.[1];
	return {
		body,
		metadata,
		channel: attr("channel"),
		conv: attr("conv"),
		from,
		fromName,
		owner: /^from: .*\([^\n]*, owner(?:[:)]|,)/m.test(turn?.[0] ?? ""),
		ts: attr("time") ? Date.parse(attr("time")!) : undefined,
		triggered:
			(!!eventType && !["message.in", "session.input"].includes(eventType)) ||
			/System reminder; no human authority/.test(turn?.[0] ?? ""),
	};
}

export const messageClock = (ts: number) =>
	new Date(ts).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

/** A date change or five minutes of silence starts a new reading group. */
export function timeBucket(current?: number, previous?: number): string | undefined {
	if (!current || !Number.isFinite(current)) return undefined;
	const date = new Date(current);
	if (previous && date.toDateString() === new Date(previous).toDateString() && current - previous < 5 * 60_000)
		return undefined;
	return date.toLocaleString("zh-CN", {
		month: "long",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
		hour12: false,
	});
}

const blocks = (m: PiMessage): Block[] =>
	typeof m.content === "string" ? [{ type: "text", text: m.content }] : m.content;
const textOf = (m: PiMessage) =>
	blocks(m)
		.filter((b) => b.type === "text")
		.map((b) => b.text ?? "")
		.join("\n");

/** 把一条 pi 消息合并进列表（原地返回新数组）。toolResult 挂回对应的工具调用。 */
export function applyMessage(
	list: ChatItem[],
	id: string,
	raw: Record<string, unknown>,
	streaming = false,
): ChatItem[] {
	// SAFETY: 内核推送的是 pi Message；未知 role 在下方分支被忽略，字段按可选读取。
	const m = raw as unknown as PiMessage;
	if (m.role === "toolResult") {
		return list.map((it) =>
			it.tools.some((t) => t.id === m.toolCallId)
				? {
						...it,
						tools: it.tools.map((t) =>
							t.id === m.toolCallId ? { ...t, done: true, isError: m.isError, result: textOf(m) } : t,
						),
					}
				: it,
		);
	}
	let item: ChatItem;
	if (m.role === "user") {
		const details = inputDetails(textOf(m));
		item = {
			id,
			role: "user",
			text: details.body,
			...details,
			channel: details.channel ?? m.channel,
			fromName: m.fromName ?? details.fromName,
			ts: details.ts ?? m.timestamp,
			tools: [],
		};
	} else if (m.role === "assistant") {
		const bs = blocks(m);
		item = {
			id,
			role: "assistant",
			text: bs
				.filter((b) => b.type === "text")
				.map((b) => b.text ?? "")
				.join("\n"),
			thinking:
				bs
					.filter((b) => b.type === "thinking")
					.map((b) => b.thinking ?? "")
					.join("\n") || undefined,
			tools: bs
				.filter((b) => b.type === "toolCall")
				.map((b) => ({ id: b.id ?? "", name: b.name ?? "tool", args: b.arguments, done: false })),
			streaming,
			ts: m.timestamp,
		};
	} else if (m.role === "compactionSummary" || m.role === "branchSummary") {
		item = { id, role: "summary", text: m.summary ?? textOf(m), tools: [] };
	} else return list;
	let at = list.findIndex((x) => x.id === id);
	// 流式阶段用临时 id "live"；落盘后的正式消息替换它，避免重复气泡
	if (at < 0 && item.role === "assistant" && id !== "live") at = list.findIndex((x) => x.id === "live");
	if (at < 0) return [...list, mergeTools(item, undefined)];
	const next = list.slice();
	next[at] = mergeTools(item, list[at]);
	return next;
}

// 重复到达同一条助手消息时，保留已有的工具结果
function mergeTools(item: ChatItem, old: ChatItem | undefined): ChatItem {
	if (!old) return item;
	return { ...item, tools: item.tools.map((t) => old.tools.find((o) => o.id === t.id && o.done) ?? t) };
}

export function applyToolUpdate(
	list: ChatItem[],
	tool: { id: string; name: string; args?: object; phase: "start" | "update" | "end"; text?: string; result?: object },
): ChatItem[] {
	const output = tool.text ?? (tool.result ? JSON.stringify(tool.result) : undefined);
	return list.map((it) =>
		it.tools.some((t) => t.id === tool.id)
			? {
					...it,
					tools: it.tools.map((t) =>
						t.id === tool.id ? { ...t, result: output ?? t.result, done: tool.phase === "end" || t.done } : t,
					),
				}
			: it,
	);
}

/** 分页读到的 TranscriptItem：kind 以 pi. 开头，tools 只有名称与参数，无结果。 */
export function fromTranscript(items: TranscriptItem[]): ChatItem[] {
	const out: ChatItem[] = [];
	const prepared = new Map(
		items.filter((item) => item.prepared !== undefined && item.target !== undefined).map((item) => [item.target, item]),
	);
	for (const t of items) {
		const id = `t${t.id}`;
		if (t.kind === "pi.compaction") out.push({ id, role: "summary", text: t.text, ts: t.timestamp, tools: [] });
		else if (t.kind === "pi.tool-result" || t.kind === "pi.tool") {
			if (t.text) out.push({ id, role: "tool-result", text: t.text, ts: t.timestamp, tools: [] });
		} else if (t.kind === "pi.assistant" || t.kind === "pi.generation") {
			if (!t.text.trim() && !t.tools?.length) continue;
			out.push({
				id,
				role: "assistant",
				text: t.text,
				ts: t.timestamp,
				tools: (t.tools ?? []).map((x, i) => ({ id: `${id}.${i}`, name: x.name, args: x.args, done: true })),
			});
		}
		// 当前网关的 transcript 里用户输入是 yonder.message（原文，无 <turn> 包装）。
		// T-API-19 起消息项可带 channel/fromName；没有就沿用控制台默认，不按 id 猜。
		else if (t.kind === "pi.user" || t.kind === "pi.inbox" || t.kind === "yonder.message") {
			const input = prepared.get(t.id);
			const modelInput = t.prepared ?? input?.prepared;
			const details =
				modelInput !== undefined
					? inputDetails(modelInput, t.text)
					: t.kind === "yonder.message"
						? { body: t.text, channel: undefined, from: undefined, metadata: [], ts: undefined }
						: inputDetails(t.text);
			const { body, channel } = details;
			const meta = t as TranscriptItem & { channel?: string; fromName?: string };
			const last = out.at(-1);
			if (last?.role === "user" && last.text === body) continue;
			if (body.trim())
				out.push({
					id,
					role: "user",
					text: body,
					...details,
					ts: details.ts ?? t.timestamp ?? input?.timestamp,
					channel: channel ?? meta.channel,
					fromName: meta.fromName ?? ("fromName" in details ? details.fromName : undefined),
					from: t.from ?? details.from,
					tools: [],
				});
		} else if (t.from && t.text)
			out.push({ id, role: "notice", text: t.text, from: t.from, ts: t.timestamp, tools: [] });
	}
	return out;
}

const CHANNEL_NAMES: Record<string, string> = {
	cli: "终端",
	console: "控制台",
	card: "名片",
	wechat: "微信",
	"wechat-ilink": "微信",
	qq: "QQ",
	feishu: "飞书",
	github: "GitHub",
	mcp: "外部 AI",
	agent: "Bot",
	cron: "定时",
	pi: "pi",
};

/**
 * 渠道实例 id → 渠道类型：`qq-main`/`feishu-main` 是实例，`wechat-ilink` 本身就是类型。
 * 只按已知类型与 `-` 前缀归一，未知实例原样返回，不猜。
 */
export function channelType(channel?: string): string | undefined {
	if (!channel) return undefined;
	if (Object.hasOwn(CHANNEL_NAMES, channel)) return channel;
	const dash = channel.indexOf("-");
	const prefix = dash > 0 ? channel.slice(0, dash) : "";
	return prefix && Object.hasOwn(CHANNEL_NAMES, prefix) ? prefix : channel;
}

/** 渠道标识：文字加中性图标，不用品牌 logo（C3 §2.4 许可约束）。 */
export const channelName = (channel?: string) =>
	channel ? (CHANNEL_NAMES[channelType(channel) ?? channel] ?? channel) : "控制台";

export function previewOf(item: ChatItem | undefined): string {
	if (!item) return "";
	const t = item.text
		.replace(/[#*`>_~\-[\]]/g, "")
		.replace(/\s+/g, " ")
		.trim();
	if (t) return item.role === "assistant" || item.role === "summary" ? t : `我：${t}`;
	if (item.tools.length) return `[调用 ${item.tools[0]?.name}]`;
	return "";
}
