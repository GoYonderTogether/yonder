import type { SessionSnapshot, TodoItem, WakeRow } from "@yonder/gateway/protocol";
import { useCallback, useMemo, useSyncExternalStore } from "react";
import {
	emptySessionState,
	type FooterStats,
	footerStats,
	type Goal,
	reduceSessionState,
	type SessionState,
} from "./session-state";
import { mux, type StreamHandlers } from "./stream";

/** 只需要 sessions.watch 的订阅面；测试直接喂 Mux 的假连接。 */
export interface StateStream {
	subscribe(method: string, params: unknown, handlers: StreamHandlers): () => void;
}

/** 未订阅时对外看到的稳定空值：getSnapshot 必须返回同一引用，否则 React 会重复渲染。 */
const EMPTY = emptySessionState();

interface Entry {
	state: SessionState;
	listeners: Set<() => void>;
	stop?: () => void;
}

export interface SessionStateStore {
	get(id: string): SessionState;
	/** 同一会话的多个 hook 共用一条 sessions.watch 订阅，最后一个退订时释放。 */
	subscribe(id: string, listener: () => void): () => void;
}

/**
 * 把 sessions.watch 的 ready 快照与增量归约为 SessionState（API-22）。
 * (sub,seq) 去重与事件 id 台账由 mux 负责；这里只在 ready 时按 gap 重建，与 useSession 同一套语义。
 */
export function createSessionStateStore(stream: StateStream = mux): SessionStateStore {
	const entries = new Map<string, Entry>();

	const apply = (id: string, action: Parameters<typeof reduceSessionState>[1]) => {
		const entry = entries.get(id);
		if (!entry) return;
		const next = reduceSessionState(entry.state, action);
		if (next === entry.state) return;
		entry.state = next;
		for (const listener of entry.listeners) listener();
	};

	return {
		get(id) {
			return entries.get(id)?.state ?? EMPTY;
		},
		subscribe(id, listener) {
			let entry = entries.get(id);
			if (!entry) {
				entry = { state: EMPTY, listeners: new Set() };
				entries.set(id, entry);
			}
			entry.listeners.add(listener);
			if (!entry.stop) {
				entry.stop = stream.subscribe(
					"sessions.watch",
					{ id },
					{
						onReady: (result, gap) => apply(id, { k: "snapshot", snap: result as SessionSnapshot, gap }),
						onEvent: (type, data) => apply(id, { k: "event", type, data: (data ?? {}) as Record<string, unknown> }),
					},
				);
			}
			return () => {
				const current = entries.get(id);
				if (!current) return;
				current.listeners.delete(listener);
				if (current.listeners.size > 0) return;
				// 退订即丢弃本地归约，重订后从 ready 快照重新开始。
				current.stop?.();
				entries.delete(id);
			};
		},
	};
}

export const sessionStateStore = createSessionStateStore();

/** 会话元信息：usage/context/model/todos/subtasks/background/wakes/goal/compaction。 */
export function useSessionState(id: string | undefined): SessionState {
	const subscribe = useCallback(
		(listener: () => void) => (id ? sessionStateStore.subscribe(id, listener) : () => undefined),
		[id],
	);
	const getSnapshot = useCallback(() => (id ? sessionStateStore.get(id) : EMPTY), [id]);
	return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** 底栏需要的字段；缺失项由 format 决定省略，不用零值占位。 */
export function useFooterStats(id: string | undefined): FooterStats {
	const state = useSessionState(id);
	return useMemo(() => footerStats(state), [state]);
}

export function useTodos(id: string | undefined): TodoItem[] {
	return useSessionState(id).todos;
}

export function useWakes(id: string | undefined): WakeRow[] {
	return useSessionState(id).wakes ?? [];
}

/** undefined=还没上报，null=明确没有目标。 */
export function useGoal(id: string | undefined): Goal | null | undefined {
	return useSessionState(id).goal;
}
