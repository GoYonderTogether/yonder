export type ChannelHealthStatus = "healthy" | "degraded" | "backoff" | "failed";

export interface ChannelHealthState {
	status: ChannelHealthStatus;
	failures: number;
	nextRetryMs: number;
	lastError?: string;
	since: number;
}

export interface ChannelHealthOptions {
	onChange?: (state: ChannelHealthState) => void;
	degradedAfter?: number;
	failedAfter?: number;
	maxRetryMs?: number;
}

const BASE_RETRY_MS = 1_000;

function describe(error: unknown): string {
	if (error instanceof Error) return error.message;
	return typeof error === "string" ? error : String(error);
}

/**
 * 渠道健康状态机。存在的理由只有一个：日志按"状态变化"记，不按"每次失败"记。
 * 同一个 `invalid appid or secret` 失败 367 次，应该只有进入失败态的 1 条。
 *
 * healthy ─失败→ degraded ─连续 N 次→ backoff ─→ failed ─成功→ healthy
 */
export function createChannelHealth(options: ChannelHealthOptions = {}) {
	const degradedAfter = Math.max(1, options.degradedAfter ?? 1);
	// failedAfter 必须晚于 degradedAfter，否则 degraded/backoff 永远没机会出现。
	const failedAfter = Math.max(degradedAfter + 1, options.failedAfter ?? 5);
	const maxRetryMs = Math.max(BASE_RETRY_MS, options.maxRetryMs ?? 300_000);

	let status: ChannelHealthStatus = "healthy";
	let failures = 0;
	let lastError: string | undefined;
	let since = Date.now();

	/** 指数退避：1s、2s、4s…到 maxRetryMs 封顶。 */
	const retryDelay = (count: number) => {
		if (count === 0) return 0;
		// 限制指数，避免失败很多次后算出 Infinity 之类无意义的中间值。
		const exponent = Math.min(count - 1, 20);
		return Math.min(BASE_RETRY_MS * 2 ** exponent, maxRetryMs);
	};

	const state = (): ChannelHealthState => ({
		status,
		failures,
		nextRetryMs: retryDelay(failures),
		since,
		...(lastError === undefined ? {} : { lastError }),
	});

	/** onChange 只在 status 真的变化时触发——这就是"不刷屏"的基础。 */
	const setStatus = (next: ChannelHealthStatus) => {
		if (next === status) return;
		status = next;
		since = Date.now();
		options.onChange?.(state());
	};

	const reset = () => {
		failures = 0;
		lastError = undefined;
		setStatus("healthy");
	};

	return {
		state,
		/** 成功一次：无论之前失败多少次，都直接回到 healthy。 */
		ok: reset,
		fail: (error: unknown): ChannelHealthState => {
			failures += 1;
			lastError = describe(error);
			const next: ChannelHealthStatus =
				failures >= failedAfter
					? "failed"
					: failures > degradedAfter
						? "backoff"
						: failures >= degradedAfter
							? "degraded"
							: "healthy";
			setStatus(next);
			return state();
		},
		nextDelay: () => retryDelay(failures),
		reset,
	};
}
