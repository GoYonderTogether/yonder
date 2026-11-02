/**
 * S3：群消息只进群会话，主对话只显示 Bot 在群里的发言与「需要关注」的摘要（SOC01-social-e2e.md S8）。
 *
 * 群绑定固定为 persistent 会话、按会话分开（`per: conv`），主会话不再承载原始群消息；
 * 允许进主对话显示通道的只有两类事件：`social.bot-speech`（Bot 在群里的发言）与
 * `social.attention`（需关注摘要，正文与格式归 O52）。其余群事件一律拒收并记账。
 */

/** 群绑定的会话目标：persistent、按会话分开。 */
export function groupSessionTarget(conv: string): { mode: "persistent"; key: string } {
	return { mode: "persistent", key: `conv:${conv}` };
}

export type MainDisplayKind = "bot-speech" | "attention";

export const mainDisplayTypes = {
	"bot-speech": "social.bot-speech",
	attention: "social.attention",
} as const;

export interface MainDisplayItem {
	id: string;
	kind: MainDisplayKind;
	conv: string;
	text: string;
	at: string;
}

/** 这两类事件可以进 main 的显示通道；原始群消息与其它事件都返回 undefined。 */
export function mainDisplayKind(event: { type: string; data?: unknown }): MainDisplayKind | undefined {
	for (const [kind, type] of Object.entries(mainDisplayTypes)) if (event.type === type) return kind as MainDisplayKind;
	return undefined;
}

/** 原始群消息只进群会话：这里给路由与测试一个单一判定点。 */
export function entersMainConversation(event: { type: string; data?: unknown }): boolean {
	return mainDisplayKind(event) !== undefined;
}

export interface GroupDisplayEvent {
	id: string;
	type: string;
	conv?: string;
	ts?: string;
	data?: unknown;
}

export interface GroupDisplayOptions {
	/** 保留条数上限，超出丢最旧的。 */
	capacity?: number;
	now?: () => string;
}

/** main 显示通道的账本：只收 Bot 群内发言与需关注摘要，拒收原始群消息并计数。 */
export class GroupDisplay {
	private readonly entries: MainDisplayItem[] = [];
	private readonly capacity: number;
	private readonly now: () => string;
	refused = 0;

	constructor(options: GroupDisplayOptions = {}) {
		this.capacity = options.capacity ?? 200;
		this.now = options.now ?? (() => new Date().toISOString());
	}

	accept(event: GroupDisplayEvent): MainDisplayItem | undefined {
		const kind = mainDisplayKind(event);
		const text = (event.data as { text?: unknown } | undefined)?.text;
		if (!kind || !event.conv || typeof text !== "string") {
			this.refused++;
			return undefined;
		}
		const item: MainDisplayItem = {
			id: event.id,
			kind,
			conv: event.conv,
			text,
			at: event.ts ?? this.now(),
		};
		this.entries.push(item);
		if (this.entries.length > this.capacity) this.entries.splice(0, this.entries.length - this.capacity);
		return item;
	}

	items(conv?: string): MainDisplayItem[] {
		return conv ? this.entries.filter((item) => item.conv === conv) : [...this.entries];
	}

	clear(): void {
		this.entries.length = 0;
	}
}
