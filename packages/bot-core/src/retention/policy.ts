import { join, relative, resolve } from "node:path";

/**
 * 保留策略：只描述"运行产物"和"派生物"留多久，不描述怎么删。
 *
 * 语义事实（`y_events`、`pi_entries`、任务笔记与交付物）不在策略范围内，
 * 见 proposals/runtime-efficiency/checklist.md 第 0 节。
 */
export interface RetentionPolicy {
	/** 运行产物：日志文件。按大小轮转。 */
	logs: {
		dir: string;
		/** 单个文件上限，超过即归档。默认 10 MB。 */
		maxBytes: number;
		/** 归档保留份数，默认 3。 */
		keep: number;
	};
	/** 运行产物：后台任务日志目录，合并为一个滚动文件。 */
	background: {
		dir: string;
		/** 目录最后修改时间超过该天数即整目录回收，默认 7。 */
		keepDays: number;
		mergedFile: string;
	};
	/** 派生物：按天数回收，具体动作由调用方提供。 */
	derived: {
		olderThanDays: number;
	};
	/** 单轮最多处理多少字节，避免长事务。默认 50 MB。 */
	budgetBytes: number;
}

export const DEFAULT_LOG_MAX_BYTES = 10 * 1024 * 1024;
export const DEFAULT_LOG_KEEP = 3;
export const DEFAULT_BACKGROUND_KEEP_DAYS = 7;
/**
 * 派生物正文的保留天数。
 *
 * 原定 30 天，实测本机全部后台终态记录都在最近 8 天内——30 天窗口等于永不回收。
 * 而这些正文在同一会话的转录 `pi_entries` 里已有副本（抽样 12/12 命中），
 * 转录只追加、不清理，所以剥离正文不会丢内容。1 天足够覆盖"刚结束还要回看"。
 */
export const DEFAULT_DERIVED_OLDER_THAN_DAYS = 1;
export const DEFAULT_BUDGET_BYTES = 50 * 1024 * 1024;

/** 运行时 home 下的默认布局；`home` 是运行时数据根，不是用户主目录。 */
export function defaultPolicy(home: string): RetentionPolicy {
	const base = join(home, ".yonder");
	return {
		logs: { dir: join(base, "logs"), maxBytes: DEFAULT_LOG_MAX_BYTES, keep: DEFAULT_LOG_KEEP },
		background: {
			dir: join(base, "background"),
			keepDays: DEFAULT_BACKGROUND_KEEP_DAYS,
			mergedFile: join(base, "background.log"),
		},
		derived: { olderThanDays: DEFAULT_DERIVED_OLDER_THAN_DAYS },
		budgetBytes: DEFAULT_BUDGET_BYTES,
	};
}

const ROOT_KEYS = ["logs", "background", "derived", "budgetBytes"] as const;
const LOG_KEYS = ["dir", "maxBytes", "keep"] as const;
const BACKGROUND_KEYS = ["dir", "keepDays", "mergedFile"] as const;
const DERIVED_KEYS = ["olderThanDays"] as const;

/**
 * 校验外部配置（通常是读进来的 JSON）。
 *
 * 拒绝未知字段是刻意的：配置里的拼写错误如果被静默忽略，
 * 会变成"策略没生效但看起来正常"，比启动失败更难排查。
 */
export function validatePolicy(value: unknown): RetentionPolicy {
	const root = section(value, "policy", ROOT_KEYS);
	const logs = section(root.logs, "policy.logs", LOG_KEYS);
	const background = section(root.background, "policy.background", BACKGROUND_KEYS);
	const derived = section(root.derived, "policy.derived", DERIVED_KEYS);
	const policy: RetentionPolicy = {
		logs: {
			dir: text(logs, "dir", "policy.logs"),
			maxBytes: integer(logs, "maxBytes", "policy.logs", DEFAULT_LOG_MAX_BYTES, 1),
			keep: integer(logs, "keep", "policy.logs", DEFAULT_LOG_KEEP, 1),
		},
		background: {
			dir: text(background, "dir", "policy.background"),
			keepDays: integer(background, "keepDays", "policy.background", DEFAULT_BACKGROUND_KEEP_DAYS, 0),
			mergedFile: text(background, "mergedFile", "policy.background"),
		},
		derived: {
			olderThanDays: integer(derived, "olderThanDays", "policy.derived", DEFAULT_DERIVED_OLDER_THAN_DAYS, 0),
		},
		budgetBytes: integer(root, "budgetBytes", "policy", DEFAULT_BUDGET_BYTES, 0),
	};
	// 合并文件若落在后台目录内，删除目录时会把它一起带走，等于边写边丢。
	if (!relative(resolve(policy.background.dir), resolve(policy.background.mergedFile)).startsWith("..")) {
		throw new Error("policy.background.mergedFile 不能位于 policy.background.dir 内部");
	}
	return policy;
}

function section(value: unknown, path: string, keys: readonly string[]): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${path} 必须是对象`);
	const record = value as Record<string, unknown>;
	for (const key of Object.keys(record)) {
		if (!keys.includes(key)) throw new Error(`${path}.${key} 不是已知字段（允许：${keys.join(", ")}）`);
	}
	return record;
}

function text(record: Record<string, unknown>, key: string, path: string): string {
	const value = record[key];
	if (typeof value !== "string" || value.trim() === "") throw new Error(`${path}.${key} 必须是非空字符串`);
	return value;
}

function integer(record: Record<string, unknown>, key: string, path: string, fallback: number, min: number): number {
	const value = record[key];
	if (value === undefined) return fallback;
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min) {
		throw new Error(`${path}.${key} 必须是 >= ${min} 的整数`);
	}
	return value;
}
