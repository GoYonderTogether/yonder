import { createPublisher } from "./publish.js";
import { sameSnapshot, statusPath, type StatusSnapshot } from "./snapshot.js";

export type { StatusSnapshot } from "./snapshot.js";

/** 状态来源：读取由内核提供，这里只负责何时读、读到之后怎么发布。 */
export interface StatusSource {
	read(): Promise<Omit<StatusSnapshot, "schemaVersion" | "revision" | "observedAt">>;
	/**
	 * 便宜的变化指示器。用事件日志的最大 id 就够：任何状态变化都会追加事件，
	 * 没有新事件就说明快照不会变，不必付 `read()` 的代价。
	 */
	watermark(): Promise<string | number | undefined>;
}

export interface StatusSurface {
	readonly path: string;
	start(): void;
	stop(): Promise<void>;
	current(): StatusSnapshot | undefined;
	/** 强制下一轮重算，用于水位无法覆盖的变化（如版本号）。 */
	markDirty(): void;
	/** 强制重算并落盘；`force` 为 true 时即使内容相同也写（心跳用）。 */
	refresh(force?: boolean): Promise<StatusSnapshot | undefined>;
}

/**
 * 状态面：把"现在怎么样"收敛成一份可读文件。
 *
 * 设计取舍：不做长连接推送。菜单栏是常驻读者，服务会重启；文件读一次是微秒级，
 * 跨重启、断线、手工排查都不需要额外协议。真正贵的是"为了读状态派生一个进程"，
 * 这里把它换成"服务自己写一次小文件"。
 */
export function createStatusSurface(options: {
	home: string;
	source: StatusSource;
	intervalMs?: number;
	heartbeatMs?: number;
	now?: () => number;
}): StatusSurface {
	const now = options.now ?? Date.now;
	const intervalMs = options.intervalMs ?? 2000;
	// 内容不变也要定期刷新 observedAt：读取方靠它判断服务是否还活着。
	// 没有心跳的话，服务挂掉后状态文件会一直停留在 ready:true。
	const heartbeatMs = options.heartbeatMs ?? 10000;
	const publisher = createPublisher(options.home);
	let snapshot: StatusSnapshot | undefined;
	let revision = 0;
	let lastWatermark: string | number | undefined;
	let lastPublishedAt = 0;
	let dirty = true;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let running = false;
	let stopped = true;
	let inFlight: Promise<StatusSnapshot | undefined> = Promise.resolve(undefined);

	const refresh = async (force = false): Promise<StatusSnapshot | undefined> => {
		const [body, watermark] = await Promise.all([options.source.read(), options.source.watermark()]);
		const next: StatusSnapshot = {
			schemaVersion: 1,
			revision,
			observedAt: now(),
			...body,
		};
		// revision 只在内容真的变了才递增；心跳刷新 observedAt 不动它，
		// 否则读取方会把"还活着"误判成"状态变了"，白重绘一次。
		const changed = !snapshot || !sameSnapshot(snapshot, next);
		if (changed) next.revision = revision + 1;
		const written = await publisher.publish(next, force);
		if (written) {
			revision = next.revision;
			lastPublishedAt = next.observedAt;
		}
		snapshot = next;
		lastWatermark = watermark;
		dirty = false;
		return snapshot;
	};

	const tick = async () => {
		if (stopped || running) return;
		running = true;
		try {
			const watermark = await options.source.watermark();
			const stale = now() - lastPublishedAt >= heartbeatMs;
			// 没有新事件、也没被显式标脏、心跳也没到，就只付一次索引查询的代价。
			if (!dirty && !stale && snapshot && watermark === lastWatermark) return;
			inFlight = refresh(stale && !dirty);
			await inFlight;
		} catch {
			// 状态读取失败不应该拖垮服务；下一轮会重试。
		} finally {
			running = false;
			if (!stopped) timer = setTimeout(() => void tick(), intervalMs);
		}
	};

	return {
		path: statusPath(options.home),
		start() {
			if (!stopped) return;
			stopped = false;
			dirty = true;
			void tick();
		},
		async stop() {
			stopped = true;
			if (timer) clearTimeout(timer);
			timer = undefined;
			await inFlight.catch(() => undefined);
			await publisher.close();
		},
		current: () => snapshot,
		markDirty() {
			dirty = true;
		},
		refresh,
	};
}
