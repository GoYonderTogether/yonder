import type { TodoItem, UsageTotals } from "../transport/types";
import type { ChatItem } from "./chat";

// imports.list / imports.show 的返回形状（packages/core/src/imports/pi-sessions.ts）。
export interface ImportSummary {
	id: string;
	sessionId?: string;
	cwd?: string;
	started?: string;
	modified: string;
	bytes: number;
	messages: number;
	title: string;
	model?: string;
}
export type ImportItem = { id: string; ts?: string } & (
	| { kind: "user"; text: string }
	| { kind: "assistant"; text: string; model?: string }
	| { kind: "thinking"; text: string }
	| { kind: "tool_call"; callId: string; name: string; args: unknown }
	| { kind: "tool_result"; callId: string; name?: string; text: string; isError?: boolean }
	| { kind: "compaction"; summary: string }
	| { kind: "system" | "event" | "unknown" }
);
export interface ImportShow {
	summary: ImportSummary;
	total: number;
	offset: number;
	hasMore: boolean;
	items: ImportItem[];
	todo: { items: (TodoItem & { blockedBy?: string[] })[]; done: number; total: number } | null;
	usage: { totals: UsageTotals };
}
export interface ImportList {
	total: number;
	sessions: ImportSummary[];
}

/** 路由里导入会话的 id 带 import: 前缀，与内核会话区分。 */
export const IMPORT_PREFIX = "import:";
export const importRoute = (id: string) => `${IMPORT_PREFIX}${id}`;

/** pi 会话条目合成气泡：同一轮的思考、正文和工具调用并进一个助手气泡，工具结果按 callId 回填。 */
export function fromImport(items: ImportItem[]): ChatItem[] {
	const out: ChatItem[] = [];
	let cur: ChatItem | undefined;
	const bot = (id: string) => {
		if (!cur) {
			cur = { id: `i${id}`, role: "assistant", text: "", tools: [] };
			out.push(cur);
		}
		return cur;
	};
	for (const it of items) {
		switch (it.kind) {
			case "user":
				cur = undefined;
				if (it.text.trim()) out.push({ id: `i${it.id}`, role: "user", text: it.text, channel: "pi", tools: [] });
				break;
			case "thinking": {
				const b = bot(it.id);
				b.thinking = b.thinking ? `${b.thinking}\n\n${it.text}` : it.text;
				break;
			}
			case "assistant": {
				const b = bot(it.id);
				b.text = b.text ? `${b.text}\n\n${it.text}` : it.text;
				break;
			}
			case "tool_call":
				bot(it.id).tools.push({ id: it.callId, name: it.name, args: it.args, done: false });
				break;
			case "tool_result":
				for (const m of out)
					for (const t of m.tools)
						if (t.id === it.callId) Object.assign(t, { result: it.text, isError: it.isError, done: true });
				break;
			case "compaction":
				cur = undefined;
				out.push({ id: `i${it.id}`, role: "summary", text: it.summary, tools: [] });
				break;
			default:
				break; // system / event / unknown：只读视图不展示
		}
	}
	return out;
}
