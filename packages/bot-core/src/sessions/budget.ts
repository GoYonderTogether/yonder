import type { YonderConfig } from "@yonder/bot-definition";
import type { Store } from "../store/contracts.js";

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

/**
 * 会话已用量。token 取 `run.end` 上记录的用量（累计已结束运行），唤醒数取已结束运行数，时长按会话打开时间
 * （`y_sessions.opened`，没有行时退到最早一次运行的 `run.end` 时间）。当前这次运行由调用方补上。
 */
function stateFromFacts(sum: import("../store/state.js").BudgetFacts, now: number): BudgetState {
	const started = [sum.opened ? Date.parse(sum.opened) : Number.NaN, sum.first ? Date.parse(sum.first) : Number.NaN]
		.filter(Number.isFinite)
		.sort((a, b) => a - b)[0];
	return { tokens: sum.tokens, minutes: started === undefined ? 0 : (now - started) / 60000, wakeups: sum.runs };
}
export async function budgetState(store: Store, session: string, now = Date.now()): Promise<BudgetState> {
	return stateFromFacts(await store.budget.read(session), now);
}

/**
 * 一次运行结束后检查三项预算（M3）。任一超限就写 `budget.exceeded`，同一会话同一项只写一次；`overBudget`
 * 首版一律只记录、不中断运行（M5，`stop` 留给后续卡）。
 */
export async function checkBudget(
	options: { store: Store; config: YonderConfig },
	session: string,
	usage: { input: number; output: number } = { input: 0, output: 0 },
	now = Date.now(),
): Promise<void> {
	const budget = options.config.budget;
	// 没配任何上限（缺省就是不限）时连查询都不做：普通 home 的运行路径与以前完全一致。
	if (![budget?.tokens, budget?.maxMinutes, budget?.maxWakeups].some(active)) return;
	const facts = await options.store.budget.read(session);
	const used = stateFromFacts(facts, now);
	// 本次运行还没写 run.end：把它自己的用量与唤醒次数补进来，否则每次判断都落后一轮。
	const state: BudgetState = {
		...used,
		tokens: used.tokens + usage.input + usage.output,
		wakeups: used.wakeups + 1,
	};
	const breaches = budgetBreaches(budget, state);
	if (breaches.length === 0) return;
	const seen = new Set(facts.seen);
	const fresh = breaches.filter((breach) => !seen.has(breach.kind));
	if (fresh.length === 0) return;
	const store = options.store;
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
