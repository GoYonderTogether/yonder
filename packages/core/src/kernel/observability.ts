import { compactBackgroundOutcomes } from "../retention/derived.js";
import { createRetention, summarizeSweep } from "../retention/index.js";
import type { Db } from "../runtime/db.js";
import { codeFor, createSignals } from "../signals/index.js";
import type { KernelLog } from "./workspace.js";

/**
 * 观测与维护：信号分级、同类聚合、保留策略调度。
 *
 * 单独成文件的原因：这三件事都是"旁路"——它们关心发生了什么，
 * 不参与会话、路由、投递的主流程。放在内核主文件里会让那个文件继续膨胀，
 * 也让主流程的读者不得不跳过一大段与流程无关的代码。
 */

/** 半小时一轮：够勤快以控制增长，又不会在活跃期反复抢 IO。 */
const RETENTION_INTERVAL_MS = 30 * 60_000;

export interface Observability {
	report(error: unknown): void;
	/** 供内核在启动后开启保留调度；`db` 用取值函数是为了避开初始化顺序。 */
	startRetention(): void;
	stop(): void;
}

export function createObservability(options: {
	home: string;
	log: KernelLog;
	db: () => Db | undefined;
}): Observability {
	const signals = createSignals({
		emit: (record) =>
			options.log(record.level, record.message, {
				code: record.code,
				count: record.count,
				firstAt: record.firstAt,
				lastAt: record.lastAt,
			}),
	});
	const retention = createRetention({
		home: options.home,
		compactDerived: async (olderThanDays, budgetBytes) => {
			const db = options.db();
			if (!db) return 0;
			const summary = await compactBackgroundOutcomes(db, { olderThanDays, budgetBytes });
			if (summary.compacted > 0)
				options.log(
					"info",
					`账本正文回收 ${summary.compacted} 条，释放 ${Math.round(summary.bytesReclaimed / 1_048_576)} MB`,
					{ code: "retention.derived", ...summary },
				);
			return summary.compacted;
		},
	});
	const report = (error: unknown) => signals.report(codeFor(error), error);
	let timer: ReturnType<typeof setInterval> | undefined;

	return {
		report,
		startRetention() {
			if (timer) return;
			timer = setInterval(() => {
				void retention.run().then(
					(result) => {
						if (result.bytesReclaimed > 0 || result.backgroundDirsRemoved > 0)
							options.log("info", summarizeSweep(result), {
								code: "retention.sweep",
								bytesReclaimed: result.bytesReclaimed,
								backgroundDirsRemoved: result.backgroundDirsRemoved,
								derivedCompacted: result.derivedCompacted,
							});
					},
					(error) => report(error),
				);
			}, RETENTION_INTERVAL_MS);
			// 保留不该单独撑住进程生命周期。
			timer.unref?.();
		},
		stop() {
			if (timer) clearInterval(timer);
			timer = undefined;
			// 退出前把窗口内被压掉的计数吐出去，别静默丢掉最后的聚合。
			signals.close();
		},
	};
}
