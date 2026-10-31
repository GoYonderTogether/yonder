/**
 * 流式打字的纯逻辑：把一段正在增长的文本切成「已稳定」与「刚出现」两截，
 * 只给新出现的字挂入场动画，已经显示的字不重播。
 * 不读 DOM、不存状态，输入是上一次的全文与这一次的全文。
 */

/** 单字 90ms、相邻字错开 30ms（见 styles.css 的 .type-in）。 */
export const TYPE_MS = 90;
export const TYPE_STAGGER_MS = 30;
/** 一次最多给多少个新字挂动画；更早的字直接显示，避免长回复一次挂几百个节点。 */
export const TYPE_WINDOW = 160;
/** 错开的步数上限：一次涌入很多字时，后面的字与第 N 个同时入场。 */
export const TYPE_MAX_STEPS = 20;

/**
 * 上次与这次的全文 → 本次新增的起始位置（字符下标）。
 * 文本被整段替换（不是前缀增长）时返回 0，让整段重新入场。
 */
export function newTailStart(previous: string, next: string): number {
	if (!previous) return 0;
	return next.startsWith(previous) ? previous.length : 0;
}

export interface TypedText {
	/** 不参与动画的前缀，原样输出 */
	head: string;
	/** 逐字入场的新字，按出现顺序 */
	chars: string[];
}

/**
 * 稳定前缀 + 逐字入场的新字。新字超过 window 时，超出的最前面部分并入 head：
 * 屏幕上留下的仍是完整文本，只是更早的字不再重播。
 */
export function splitForTyping(text: string, start: number, window = TYPE_WINDOW): TypedText {
	const at = Math.max(0, Math.min(start, text.length));
	const tail = text.slice(at);
	if (tail.length <= window) return { head: text.slice(0, at), chars: Array.from(tail) };
	const skip = tail.length - window;
	return { head: text.slice(0, at + skip), chars: Array.from(tail.slice(skip)) };
}

/** 第 i 个新字的动画延迟（ms）。 */
export function charDelay(index: number): number {
	return Math.min(index, TYPE_MAX_STEPS) * TYPE_STAGGER_MS;
}
