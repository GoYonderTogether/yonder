import { useSyncExternalStore } from "react";
import type { ActivitySummary, SessionInfo } from "../api/types";
import { groupOf } from "./identity";

// 工作列表的分组、默认折叠与折叠持久化。归档、置顶走内核字段（§18），只有折叠存客户端。
export type TaskStatus = "running" | "waiting" | "idle" | "done";
export type ActivityState = ActivitySummary["sessions"][number]["state"];
type ActivitySession = ActivitySummary["sessions"][number];

/** contracts.md §18 的 session 增补字段；旧会话缺字段时按缺省（未归档、未置顶、owner）。 */
export interface WorkbenchFields {
	owner?: { kind: "owner" | "bot"; id: string };
	archivedAt?: number;
	needsOwner?: { reason: string; since: number };
	channels?: string[];
	parent?: string;
	pinned?: boolean;
	title?: string;
}
export type WorkSession = SessionInfo & WorkbenchFields;

export const TASK_ORDER: TaskStatus[] = ["running", "waiting", "idle", "done"];
export const STATUS_TITLE: Record<TaskStatus, string> = {
	running: "进行中",
	waiting: "需要你",
	idle: "待命",
	done: "已完成",
};

/** 已关闭或已归档的任务算完成；活动摘要只区分运行中、等你回答，其余（含 error 与缺失）按待命。 */
export function taskStatus(s: WorkSession, state?: ActivityState): TaskStatus {
	if (s.closed || s.archivedAt) return "done";
	if (s.needsOwner || state === "waiting") return "waiting";
	if (state === "running") return "running";
	return "idle";
}

export type TimeKey = "today" | "yesterday" | "earlier";
export const TIME_ORDER: TimeKey[] = ["today", "yesterday", "earlier"];
export const TIME_TITLE: Record<TimeKey, string> = { today: "今天", yesterday: "昨天", earlier: "更早" };

/** 按本地日历日分组；无法解析的时间算更早。 */
export function timeKey(iso: string, now: Date = new Date()): TimeKey {
	const t = new Date(iso);
	if (Number.isNaN(t.getTime())) return "earlier";
	const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
	const diff = Math.round((day(now) - day(t)) / 86_400_000);
	return diff <= 0 ? "today" : diff === 1 ? "yesterday" : "earlier";
}

export interface WorkGroups {
	/** 常驻 Bot，按会话列表原顺序；已关闭的不列。 */
	bots: WorkSession[];
	/** 需要主人的任务（Bot 递上来的、或在等回答）。 */
	needsYou: WorkSession[];
	/** 进行中（运行中）。 */
	running: WorkSession[];
	/** 置顶的长期任务（内核 pinned 字段），按打开时间倒序。 */
	pinned: WorkSession[];
	byTime: Record<TimeKey, WorkSession[]>;
	/** 已完成 = 关闭或归档。 */
	done: WorkSession[];
}

export interface GroupOpts {
	now?: Date;
}

/**
 * 纯分组：Bot 单列；任务按「需要你 / 进行中 / 置顶 / 今天昨天更早 / 已完成」归组，组内按打开时间倒序。
 * Bot 发起的任务默认只挂在 Bot 下，除非它递上来（needsOwner）。导入的 pi 会话不参与。
 */
export function groupWork(
	sessions: readonly WorkSession[],
	state: ReadonlyMap<string, ActivitySession> = new Map(),
	opts: GroupOpts = {},
): WorkGroups {
	const out: WorkGroups = {
		bots: [],
		needsYou: [],
		running: [],
		pinned: [],
		byTime: { today: [], yesterday: [], earlier: [] },
		done: [],
	};
	for (const s of sessions) {
		const g = groupOf(s);
		if (g === "bot") {
			if (!s.closed) out.bots.push(s);
			continue;
		}
		if (g !== "task") continue;
		const status = taskStatus(s, state.get(s.id)?.state);
		if (s.owner?.kind === "bot" && !s.needsOwner) continue;
		if (status === "done") out.done.push(s);
		else if (status === "waiting") out.needsYou.push(s);
		else if (s.pinned) out.pinned.push(s);
		else if (status === "running") out.running.push(s);
		else out.byTime[timeKey(s.opened, opts.now)].push(s);
	}
	const newest = (a: WorkSession, b: WorkSession) => b.opened.localeCompare(a.opened);
	for (const list of [out.needsYou, out.running, out.done, ...Object.values(out.byTime)]) list.sort(newest);
	return out;
}

// 折叠状态：「已完成」与「进行中更多」默认收起。
export type FoldKey = "done" | "runningMore";
/** 只记录用户手动切换过的分组；没有记录的分组走默认值。 */
export type Folds = Partial<Record<FoldKey, boolean>>;
const FOLD_KEYS: FoldKey[] = ["done", "runningMore"];
const KEY = "yonder.work.fold";

export const defaultOpen = (_key: FoldKey): boolean => false;
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
