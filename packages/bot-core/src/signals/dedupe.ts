import type { SignalCode, SignalLevel } from "./codes.js";

/**
 * 一条对外信号。count 表示"这一条记录代表了几次发生"：
 * 首次记录是 1，周期汇总是该窗口内被压掉的次数。
 * detail 保留首次出现时的上下文，后续重复不覆盖——排查要看的是第一现场。
 */
export interface SignalRecord {
	code: SignalCode;
	level: SignalLevel;
	message: string;
	count: number;
	firstAt: number;
	lastAt: number;
	detail?: unknown;
}

export interface DedupeInput {
	code: SignalCode;
	level: SignalLevel;
	message: string;
	detail?: unknown;
}

export interface DedupeOptions {
	emit: (record: SignalRecord) => void;
	now?: () => number;
	flushMs?: number;
}

interface Entry {
	level: SignalLevel;
	message: string;
	detail?: unknown;
	/** 自首次出现以来的总次数，仅用于摘要文案。 */
	total: number;
	/** 自上次输出以来被压掉的次数；0 表示窗口内没有新事件。 */
	suppressed: number;
	firstAt: number;
	lastAt: number;
}

const DEFAULT_FLUSH_MS = 60_000;

/**
 * 同类聚合器：首次立即全量输出，之后只累加计数，按周期吐一条摘要。
 * 这样单次启动 11,726 条"无回执"变成 1 条 warn + 每分钟最多 1 条摘要。
 */
export function createDedupe(options: DedupeOptions) {
	const now = options.now ?? Date.now;
	const flushMs = options.flushMs ?? DEFAULT_FLUSH_MS;
	const entries = new Map<SignalCode, Entry>();
	let closed = false;

	const flush = () => {
		// 先收集再输出：emit 抛错时不会留下"计数已清零但没输出"的半截状态。
		const records: SignalRecord[] = [];
		for (const [code, entry] of entries) {
			if (entry.suppressed === 0) continue;
			records.push({
				code,
				level: entry.level,
				// 摘要必须自带次数，否则落到日志里看不出被压掉了多少。
				message: `${entry.message}（同类 ${entry.suppressed} 次，累计 ${entry.total} 次）`,
				count: entry.suppressed,
				firstAt: entry.firstAt,
				lastAt: entry.lastAt,
				...(entry.detail === undefined ? {} : { detail: entry.detail }),
			});
			entry.suppressed = 0;
		}
		for (const record of records) options.emit(record);
	};

	const report = (input: DedupeInput) => {
		if (closed) return;
		const at = now();
		const existing = entries.get(input.code);
		if (!existing) {
			entries.set(input.code, {
				level: input.level,
				message: input.message,
				...(input.detail === undefined ? {} : { detail: input.detail }),
				total: 1,
				suppressed: 0,
				firstAt: at,
				lastAt: at,
			});
			// 首次出现立刻输出：真故障不能等到下一个窗口才可见。
			options.emit({
				code: input.code,
				level: input.level,
				message: input.message,
				count: 1,
				firstAt: at,
				lastAt: at,
				...(input.detail === undefined ? {} : { detail: input.detail }),
			});
			return;
		}
		// 重复出现不更新 level/message/detail：首次那次的现场才是有信息量的。
		existing.total += 1;
		existing.suppressed += 1;
		existing.lastAt = at;
	};

	const close = () => {
		if (closed) return;
		// 关闭前把窗口内的计数吐出去，避免进程退出时静默丢掉最后的聚合。
		flush();
		closed = true;
		clearInterval(timer);
	};

	const timer = setInterval(flush, flushMs);
	// 定时器不应该单独撑住进程生命周期；服务退出由显式 close 负责。
	timer.unref?.();

	return { report, flush, close };
}
