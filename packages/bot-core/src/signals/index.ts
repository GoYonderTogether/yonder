import { levelOf, type SignalCode, type SignalLevel } from "./codes.js";
import { createDedupe, type SignalRecord } from "./dedupe.js";

export { codeFor, isSignalCode, levelOf } from "./codes.js";
export type { SignalCode, SignalLevel, SignalRecord };

export interface SignalsOptions {
	emit: (record: SignalRecord) => void;
	now?: () => number;
	flushMs?: number;
}

export interface Signals {
	report(code: SignalCode, error: unknown, detail?: unknown): void;
	flush(): void;
	close(): void;
}

/** throw 出来的不一定是 Error（插件常见字符串/对象），统一压成一行可读文本。 */
function describe(error: unknown): string {
	if (error instanceof Error) return error.message;
	return typeof error === "string" ? error : String(error);
}

/**
 * 信号唯一出口：分级 + 聚合都在这里完成，调用方只报"发生了什么"。
 * 接线层保留原 onReport(error) 签名时，用 code="unknown" 即可，默认降为 warn。
 */
export function createSignals(options: SignalsOptions): Signals {
	const dedupe = createDedupe({
		emit: options.emit,
		...(options.now === undefined ? {} : { now: options.now }),
		...(options.flushMs === undefined ? {} : { flushMs: options.flushMs }),
	});
	return {
		report(code, error, detail) {
			dedupe.report({
				code,
				level: levelOf(code),
				message: describe(error),
				...(detail === undefined ? {} : { detail }),
			});
		},
		flush: dedupe.flush,
		close: dedupe.close,
	};
}
