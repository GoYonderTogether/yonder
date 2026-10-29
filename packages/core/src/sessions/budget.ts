import type { YonderConfig } from "../config/index.js";
import type { Db } from "../runtime/db.js";
import { createStore } from "../store/index.js";

/** `budget.exceeded`（contracts §3.3 之外的事实事件）：某一项预算首次超限时记录一次。 */
export const budgetEventType = "budget.exceeded";

export type BudgetKind = "tokens" | "minutes" | "wakeups";

/** 会话已用：token 累计量、打开后经过的分钟数、唤醒（=运行）次数。 */
export interface BudgetState {
	tokens: number;
	minutes: number;
	wakeups: number;
}

export interface BudgetBreach {
	kind: BudgetKind;
	limit: number;
	value: number;
}

export type BudgetLimits = YonderConfig["budget"];

/** 一项上限生效与否：缺省或 0 表示不限（M3 三项同时生效，各自独立）。 */
const active = (limit: number | undefined): limit is number => limit !== undefined && limit > 0;

/** 超限明细；只列真正被越过的那几项，未配置的项永远不算超限。 */
export function budgetBreaches(budget: BudgetLimits, state: BudgetState): BudgetBreach[] {
	const limits: Array<[BudgetKind, number | undefined]> = [
		["tokens", budget?.tokens],
		["minutes", budget?.maxMinutes],
		["wakeups", budget?.maxWakeups],
	];
	return limits.flatMap(([kind, limit]) =>
		active(limit) && state[kind] > limit ? [{ kind, limit, value: state[kind] }] : [],
	);
}

/** 已记录事件的 kind；旧行或损坏的 data 一律当未知，宁可多记一次也不丢事件。 */
const dataKind = (data: string): string | undefined => {
	try {
		return (JSON.parse(data) as { kind?: string }).kind;
	} catch {
		return undefined;
	}
};

interface SumRow {
	tokens: number | null;
	runs: number | null;
	first: string | null;
}

/**
 * 会话已用量。token 取 `run.end` 上记录的用量（累计已结束运行），唤醒数取已结束运行数，时长按会话打开时间
 * （`y_sessions.opened`，没有行时退到最早一次运行的 `run.end` 时间）。当前这次运行由调用方补上。
 */
export async function budgetState(db: Db, session: string, now = Date.now()): Promise<BudgetState> {
	const sum = await db.get<SumRow>(
		`SELECT COALESCE(SUM(json_extract(data, '$.usage.input') + json_extract(data, '$.usage.output')), 0) AS tokens,
			COUNT(*) AS runs, MIN(ts) AS first
			FROM y_events WHERE type = 'run.end' AND json_extract(data, '$.session') = ?`,
		session,
	);
	const opened = await db.get<{ opened: string }>("SELECT opened FROM y_sessions WHERE id = ?", Number(session));
	const started = [opened ? Date.parse(opened.opened) : Number.NaN, sum?.first ? Date.parse(sum.first) : Number.NaN]
		.filter((value) => Number.isFinite(value))
		.sort((a, b) => a - b)[0];
	return {
		tokens: Number(sum?.tokens ?? 0),
		minutes: started === undefined ? 0 : (now - started) / 60_000,
		wakeups: Number(sum?.runs ?? 0),
	};
}

/**
 * 一次运行结束后检查三项预算（M3）。任一超限就写 `budget.exceeded`，同一会话同一项只写一次；`overBudget`
 * 首版一律只记录、不中断运行（M5，`stop` 留给后续卡）。
 */
export async function checkBudget(
	options: { db: Db; config: YonderConfig },
	session: string,
	usage: { input: number; output: number } = { input: 0, output: 0 },
	now = Date.now(),
): Promise<void> {
	const budget = options.config.budget;
	// 没配任何上限（缺省就是不限）时连查询都不做：普通 home 的运行路径与以前完全一致。
	if (![budget?.tokens, budget?.maxMinutes, budget?.maxWakeups].some(active)) return;
	const used = await budgetState(options.db, session, now);
	// 本次运行还没写 run.end：把它自己的用量与唤醒次数补进来，否则每次判断都落后一轮。
	const state: BudgetState = {
		...used,
		tokens: used.tokens + usage.input + usage.output,
		wakeups: used.wakeups + 1,
	};
	const breaches = budgetBreaches(budget, state);
	if (breaches.length === 0) return;
	const recorded = await options.db.all<{ data: string }>(
		"SELECT data FROM y_events WHERE type = ? AND json_extract(data, '$.session') = ?",
		budgetEventType,
		session,
	);
	const seen = new Set(recorded.map((row) => dataKind(row.data)));
	const fresh = breaches.filter((breach) => !seen.has(breach.kind));
	if (fresh.length === 0) return;
	const store = await createStore(options.db);
	for (const breach of fresh)
		await store.events.record({
			type: budgetEventType,
			data: {
				session,
				kind: breach.kind,
				limit: breach.limit,
				value: breach.value,
				state,
				limits: { ...budget },
				action: budget?.overBudget ?? "record",
			},
		});
}
