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
	/** 用户消息的来源渠道（来自 <turn channel="…">），无则是本机控制台 */
	channel?: string;
	from?: string;
	streaming?: boolean;
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
}

const TURN = /^<turn\b([^>]*)>[\s\S]*?<\/turn>\s*/;

export function splitTurn(text: string): { body: string; channel?: string } {
	const m = TURN.exec(text);
	if (!m) return { body: text };
	return { body: text.slice(m[0].length), channel: /channel="([^"]*)"/.exec(m[1] ?? "")?.[1] };
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
		const { body, channel } = splitTurn(textOf(m));
		item = { id, role: "user", text: body, channel, tools: [] };
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
	for (const t of items) {
		const id = `t${t.id}`;
		if (t.kind === "pi.compaction") out.push({ id, role: "summary", text: t.text, tools: [] });
		else if (t.kind === "pi.tool-result" || t.kind === "pi.tool") {
			if (t.text) out.push({ id, role: "tool-result", text: t.text, tools: [] });
		} else if (t.kind === "pi.assistant" || t.kind === "pi.generation") {
			if (!t.text.trim() && !t.tools?.length) continue;
			out.push({
				id,
				role: "assistant",
				text: t.text,
				tools: (t.tools ?? []).map((x, i) => ({ id: `${id}.${i}`, name: x.name, args: x.args, done: true })),
			});
		}
		// 当前网关的 transcript 里用户输入是 yonder.message（原文，无 <turn> 包装）
		else if (t.kind === "pi.user" || t.kind === "pi.inbox" || t.kind === "yonder.message") {
			const { body, channel } = splitTurn(t.text);
			const last = out.at(-1);
			if (last?.role === "user" && last.text === body) continue;
			if (body.trim()) out.push({ id, role: "user", text: body, channel, from: t.from, tools: [] });
		} else if (t.from && t.text) out.push({ id, role: "notice", text: t.text, from: t.from, tools: [] });
	}
	return out;
}

const CHANNEL_NAMES: Record<string, string> = {
	cli: "终端",
	card: "名片",
	wechat: "微信",
	"wechat-ilink": "微信",
	qq: "QQ",
	feishu: "飞书",
	github: "GitHub",
	mcp: "外部 AI",
	agent: "Agent",
	cron: "定时",
	pi: "pi",
};
/** 渠道标识：文字加中性图标，不用品牌 logo（C3 §2.4 许可约束）。 */
export const channelName = (channel?: string) => (channel ? (CHANNEL_NAMES[channel] ?? channel) : "控制台");

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
