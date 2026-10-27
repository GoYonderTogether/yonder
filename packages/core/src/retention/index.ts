import { defaultPolicy, type RetentionPolicy, validatePolicy } from "./policy.js";
import type { SweepResult } from "./report.js";
import { createSweep } from "./sweep.js";

export type { RetentionPolicy } from "./policy.js";
export {
	DEFAULT_BUDGET_BYTES,
	DEFAULT_LOG_KEEP,
	DEFAULT_LOG_MAX_BYTES,
	defaultPolicy,
	validatePolicy,
} from "./policy.js";
export type { SweepResult } from "./report.js";
export { summarizeSweep } from "./report.js";
export type { SweepDeps } from "./sweep.js";

export interface RetentionOptions {
	/** 运行时 home，默认布局由它推导。 */
	home: string;
	/** 已解析的配置（通常来自 validatePolicy 或 JSON.parse）；内部会再校验一次。 */
	policy?: unknown;
	/** 派生物回收动作，由调用方提供；不传则跳过这一档。 */
	compactDerived?: (olderThanDays: number, budgetBytes: number) => Promise<number>;
	now?: () => number;
}

export interface Retention {
	/** 跑一轮；并发调用共享同一轮，不排队。 */
	run(): Promise<SweepResult>;
	/** 当前生效策略的副本，外部改动不影响引擎。 */
	policy(): RetentionPolicy;
}

/**
 * 保留引擎：只处置运行产物与派生物，永不触碰语义事实。
 * 调度（多久跑一次）留给调用方，本模块不含定时器。
 */
export function createRetention(options: RetentionOptions): Retention {
	const policy = options.policy === undefined ? defaultPolicy(options.home) : validatePolicy(options.policy);
	const sweep = createSweep({
		policy,
		...(options.compactDerived ? { compactDerived: options.compactDerived } : {}),
		...(options.now ? { now: options.now } : {}),
	});
	return { run: () => sweep.run(), policy: () => structuredClone(policy) };
}
