import type { Query, QueryClient } from "@tanstack/react-query";
import type { StateMode } from "./viewState";

/**
 * 状态模拟：把应用真实的 React Query 缓存临时改成 loading / error / 空响应，
 * 让页面用它们自己的分支渲染。这里不另建数据源、不返回业务内容：
 * - loading 只是把查询退回 pending（等同慢网络）；
 * - error 只是一个带标记的错误对象（等同网关报错）；
 * - empty 只对本来就是数组的查询生效，替换成空数组（等同服务端返回 0 条）。
 * 非数组结果的查询跳过，不去编造对象结构。退出时按快照恢复。
 */

/** 模拟错误带标记，恢复时据此识别，也方便页面显示时说明来源。 */
export class DevtoolsStateError extends Error {
	readonly devtools = true;
	constructor() {
		super("状态模拟：网关请求失败（开发工具）");
		this.name = "DevtoolsStateError";
	}
}

/** 会被覆盖的字段；只碰状态，不碰查询函数与选项。 */
export interface QueryStatePatch {
	status: "pending" | "error" | "success";
	fetchStatus: "fetching" | "idle";
	data?: unknown;
	error: Error | null;
}

/**
 * 目标模式要写入的补丁。data 是查询当前的缓存值，用来判断空响应是否适用。
 * none 与非数组数据的 empty 返回 undefined（不覆盖）。
 * loading（pending + fetching）才同时命中页面的 isPending 与 isLoading 分支。
 */
export function forcedQueryState(mode: StateMode, current: { data: unknown }): QueryStatePatch | undefined {
	switch (mode) {
		case "loading":
			return { status: "pending", fetchStatus: "fetching", data: undefined, error: null };
		case "error":
			return { status: "error", fetchStatus: "idle", error: new DevtoolsStateError() };
		case "empty":
			return Array.isArray(current.data)
				? { status: "success", fetchStatus: "idle", data: [], error: null }
				: undefined;
		default:
			return undefined;
	}
}

/** 当前查询是否已经处在目标状态；已处在就不重复 setState（避免和缓存订阅互相触发）。 */
export function isForcedState(
	mode: StateMode,
	state: { status: string; fetchStatus?: string; data: unknown; error: unknown },
): boolean {
	switch (mode) {
		case "loading":
			return state.status === "pending" && state.fetchStatus === "fetching" && state.data === undefined;
		case "error":
			return state.status === "error" && state.error instanceof DevtoolsStateError;
		case "empty":
			return state.status === "success" && Array.isArray(state.data) && state.data.length === 0;
		default:
			return true;
	}
}

/** 覆盖前保存的查询状态；恢复时原样写回。 */
type SavedState = Query["state"];

export interface StateOverrideHandle {
	/** 已经覆盖（或已处在目标状态）的查询数。 */
	count(): number;
	/** 恢复所有被覆盖的查询并停止追踪。 */
	stop(): void;
}

/**
 * 对缓存里已存在的查询逐个套用目标状态，并订阅缓存：轮询刷新会把数据写回来，
 * 这里在它们更新后重新套用，保证预览期间始终显示目标状态。返回的句柄用于恢复。
 */
export function applyStateOverride(client: QueryClient, mode: StateMode): StateOverrideHandle {
	if (mode === "none") return { count: () => 0, stop: () => undefined };
	const cache = client.getQueryCache();
	const saved = new Map<string, { query: Query; state: SavedState }>();
	let stopped = false;

	const force = (query: Query) => {
		const patch = forcedQueryState(mode, { data: query.state.data });
		if (!patch) return;
		if (!saved.has(query.queryHash)) saved.set(query.queryHash, { query, state: query.state });
		if (!isForcedState(mode, query.state)) query.setState(patch);
	};

	// 先取消在途请求，避免刚套上的状态被马上返回的响应覆盖。
	const existing = cache.getAll();
	for (const query of existing) void query.cancel();
	for (const query of existing) force(query);

	const unsubscribe = cache.subscribe((event) => {
		if (stopped) return;
		// "added" 覆盖预览期间新出现的查询（切页、打开会话），否则只有旧查询被覆盖。
		if (event.type !== "updated" && event.type !== "added") return;
		force(event.query);
	});

	return {
		count: () => saved.size,
		stop: () => {
			stopped = true;
			unsubscribe();
			for (const item of saved.values()) {
				item.query.setState(item.state);
				// 覆盖期间取消过在途请求、轮询结果也被挡掉了：对仍被页面观察的查询重新取一次真实数据，
				// 避免退出后停在旧值或 pending。数据依旧只来自网关，不在这里补任何值。
				if (item.query.observers.length > 0) void item.query.fetch().catch(() => undefined);
			}
			saved.clear();
		},
	};
}
