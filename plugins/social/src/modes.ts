/**
 * 群监听模式引擎（C2/C3/M4）：参数来自 `social.listen`，逐群可覆盖，时间来自可注入时钟。
 *
 * 四种模式（GRP01-channel-tree.md §1、§3）：
 * - realtime：15 秒内有新消息就续等，最长 2 分钟一包；
 * - batch：关键消息（群主、带链接/图片）立即出包，其余 5 分钟窗口合并；
 * - mention：只看 @，@ 消息强接收立即出包；
 * - digest：窗口内累计够 minMessages 条才出一次判断，窗口到点不足则丢弃。
 *
 * 输出统一为 `Batch{conv, messages, trigger}`，供 IMP-15 的便宜模型判定与快照合并消费。
 */

export type ListenMode = "realtime" | "batch" | "mention" | "digest";
export type KeyRule = "owner" | "link" | "image";
export type BatchTrigger = "quiet" | "max-window" | "window" | "key" | "mention" | "digest";

export interface ListenConfig {
	mode: ListenMode;
	realtime: { quietSec: number; maxWindowSec: number };
	batch: { windowSec: number; keyRules: KeyRule[] };
	digest: { windowMin: number; minMessages: number };
	mention: { strong: boolean };
}

/** 与 `packages/core/src/config/social-schema.ts` 的 `socialDefaults.listen` 一致；插件只依赖 SDK，故本地保留一份。 */
export const listenDefaults: ListenConfig = {
	mode: "realtime",
	realtime: { quietSec: 15, maxWindowSec: 120 },
	batch: { windowSec: 300, keyRules: ["owner", "link", "image"] },
	digest: { windowMin: 15, minMessages: 5 },
	mention: { strong: true },
};

/** 合并 `social.listen` 的默认值与逐群覆盖。 */
export function resolveListen(override?: Partial<ListenConfig>, base: ListenConfig = listenDefaults): ListenConfig {
	return {
		mode: override?.mode ?? base.mode,
		realtime: { ...base.realtime, ...override?.realtime },
		batch: { ...base.batch, ...override?.batch },
		digest: { ...base.digest, ...override?.digest },
		mention: { ...base.mention, ...override?.mention },
	};
}

export interface ModeMessage {
	id: string;
	at: number;
	text?: string;
	owner?: boolean;
	mentionsBot?: boolean;
	link?: boolean;
	image?: boolean;
}

export interface ModeInput {
	id: string;
	at?: number;
	text?: string;
	owner?: boolean;
	mentionsBot?: boolean;
	link?: boolean;
	image?: boolean;
}

export interface Batch {
	conv: string;
	messages: ModeMessage[];
	trigger: BatchTrigger;
}

export interface Clock {
	now(): number;
}

interface ConvState {
	openedAt: number;
	messages: ModeMessage[];
}

const isKey = (config: ListenConfig, message: ModeMessage) =>
	(config.batch.keyRules.includes("owner") && message.owner === true) ||
	(config.batch.keyRules.includes("link") && message.link === true) ||
	(config.batch.keyRules.includes("image") && message.image === true);

export class ListenModes {
	private readonly states = new Map<string, ConvState>();
	private readonly clock: Clock;
	private readonly listen: (conv: string) => ListenConfig;

	constructor(options: { clock?: Clock; listen?: (conv: string) => ListenConfig } = {}) {
		this.clock = options.clock ?? { now: () => Date.now() };
		this.listen = options.listen ?? (() => listenDefaults);
	}

	/** 收一条群消息；立即就绪的模式（关键消息、@、摘要满额）当场出包。 */
	push(conv: string, input: ModeInput): Batch | undefined {
		const config = this.listen(conv);
		if (config.mode === "mention" && config.mention.strong && input.mentionsBot !== true) return undefined;
		const message: ModeMessage = { ...input, at: input.at ?? this.clock.now() };
		let state = this.states.get(conv);
		if (!state) {
			state = { openedAt: message.at, messages: [] };
			this.states.set(conv, state);
		}
		state.messages.push(message);
		if (config.mode === "mention" && config.mention.strong) return this.flush(conv, "mention");
		if (config.mode === "batch" && isKey(config, message)) return this.flush(conv, "key");
		if (config.mode === "digest" && state.messages.length >= config.digest.minMessages)
			return this.flush(conv, "digest");
		return undefined;
	}

	/** 时钟推进后取出所有到期批次：静默窗口、最长窗口、打包窗口、摘要窗口。 */
	drain(): Batch[] {
		const now = this.clock.now();
		const batches: Batch[] = [];
		for (const conv of [...this.states.keys()]) {
			const batch = this.due(conv, now);
			if (batch) batches.push(batch);
		}
		return batches;
	}

	/** 当前未出包的消息数。 */
	pending(conv: string): number {
		return this.states.get(conv)?.messages.length ?? 0;
	}

	reset(conv?: string): void {
		if (conv === undefined) this.states.clear();
		else this.states.delete(conv);
	}

	private due(conv: string, now: number): Batch | undefined {
		const state = this.states.get(conv);
		const last = state?.messages.at(-1);
		if (!state || !last) return undefined;
		const config = this.listen(conv);
		const realtime = config.mode === "mention" ? !config.mention.strong : config.mode === "realtime";
		if (config.mode === "batch") {
			if (now - state.openedAt < config.batch.windowSec * 1000) return undefined;
			return this.flush(conv, "window");
		}
		if (config.mode === "digest") {
			if (now - state.openedAt < config.digest.windowMin * 60_000) return undefined;
			this.states.delete(conv);
			return undefined;
		}
		if (!realtime) return undefined;
		if (now - state.openedAt >= config.realtime.maxWindowSec * 1000) return this.flush(conv, "max-window");
		if (now - last.at >= config.realtime.quietSec * 1000) return this.flush(conv, "quiet");
		return undefined;
	}

	private flush(conv: string, trigger: BatchTrigger): Batch {
		const messages = this.states.get(conv)?.messages ?? [];
		this.states.delete(conv);
		return { conv, messages, trigger };
	}
}
