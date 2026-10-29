import { useSyncExternalStore } from "react";
import type { ActivitySummary, SessionInfo } from "../api/types";
import { groupOf } from "./identity";

// 工作列表的任务分组、默认折叠与折叠持久化。折叠只存客户端，不改内核契约。
export type TaskStatus = "running" | "waiting" | "idle" | "done";
export type ActivityState = ActivitySummary["sessions"][number]["state"];
type ActivitySession = ActivitySummary["sessions"][number];

export const TASK_ORDER: TaskStatus[] = ["running", "waiting", "idle", "done"];
export const STATUS_TITLE: Record<TaskStatus, string> = {
	running: "运行中",
	waiting: "等你回答",
	idle: "待命",
	done: "已完成",
};

/** 已关闭的任务算完成；活动摘要只区分运行中、等你回答，其余（含 error 与缺失）按待命。 */
export function taskStatus(s: SessionInfo, state?: ActivityState): TaskStatus {
	if (s.closed) return "done";
	if (state === "running") return "running";
	if (state === "waiting") return "waiting";
	return "idle";
}

export interface WorkGroups {
	/** 常驻 Bot，按会话列表原顺序；已关闭的不列。 */
	bots: SessionInfo[];
	byStatus: Record<TaskStatus, SessionInfo[]>;
}

/** 纯分组：Bot 与任务分开，任务按状态归组，组内按打开时间倒序。导入的 pi 会话不参与。 */
export function groupWork(
	sessions: readonly SessionInfo[],
	state: ReadonlyMap<string, ActivitySession> = new Map(),
): WorkGroups {
	const bots: SessionInfo[] = [];
	const byStatus: Record<TaskStatus, SessionInfo[]> = { running: [], waiting: [], idle: [], done: [] };
	for (const s of sessions) {
		const g = groupOf(s);
		if (g === "bot") {
			if (!s.closed) bots.push(s);
		} else if (g === "task") {
			byStatus[taskStatus(s, state.get(s.id)?.state)].push(s);
		}
	}
	for (const list of Object.values(byStatus)) list.sort((a, b) => b.opened.localeCompare(a.opened));
	return { bots, byStatus };
}

/** 任务进度条用的计数：已完成 / 全部任务。 */
export function progressOf(byStatus: Record<TaskStatus, SessionInfo[]>): { total: number; done: number } {
	const total = TASK_ORDER.reduce((n, k) => n + byStatus[k].length, 0);
	return { total, done: byStatus.done.length };
}

// 折叠状态：Bot 区与四个任务分组各一份；已完成默认收起，其余默认展开。
export type FoldKey = TaskStatus | "bot";
/** 只记录用户手动切换过的分组；没有记录的分组走默认值。 */
export type Folds = Partial<Record<FoldKey, boolean>>;
const FOLD_KEYS: FoldKey[] = [...TASK_ORDER, "bot"];
const KEY = "yonder.work.fold";

export const defaultOpen = (key: FoldKey): boolean => key !== "done";
export const isOpen = (folds: Folds, key: FoldKey): boolean => folds[key] ?? defaultOpen(key);
export const toggleFold = (folds: Folds, key: FoldKey): Folds => ({ ...folds, [key]: !isOpen(folds, key) });

/** 损坏的存档回到默认；非布尔值和不认识的键丢弃。 */
export function parseFolds(raw: string | null): Folds {
	let value: unknown;
	try {
		value = JSON.parse(raw ?? "{}");
	} catch {
		return {};
	}
	if (!value || typeof value !== "object" || Array.isArray(value)) return {};
	const record = value as Record<string, unknown>;
	const folds: Folds = {};
	for (const key of FOLD_KEYS) {
		const v = record[key];
		if (typeof v === "boolean") folds[key] = v;
	}
	return folds;
}

let cached: Folds | undefined;
const listeners = new Set<() => void>();
function read(): Folds {
	cached ??= parseFolds(localStorage.getItem(KEY));
	return cached;
}
function commit(next: Folds) {
	cached = next;
	localStorage.setItem(KEY, JSON.stringify(next));
	for (const fn of listeners) fn();
}
export function toggleFolds(key: FoldKey) {
	commit(toggleFold(read(), key));
}
const subscribe = (fn: () => void) => {
	listeners.add(fn);
	return () => void listeners.delete(fn);
};
export const useFolds = () => useSyncExternalStore(subscribe, read);
