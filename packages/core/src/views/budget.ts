import type { ViewDecl, ViewProvider } from "@yonder/sdk";
import type { YonderConfig } from "../config/index.js";
import type { Db } from "../runtime/db.js";
import { type BudgetState, budgetEventType, budgetState } from "../sessions/budget.js";

/** 预算视图 id（M5：控制台显示用量与上限，前端另卡）。 */
export const budgetViewId = "core.budget";

const value = (used: number, limit: number | undefined, unit: string) =>
	limit === undefined || limit <= 0 ? `${used}${unit}（不限）` : `${used} / ${limit}${unit}`;

/**
 * 预算只读视图：三项预算的已用量与上限。数据来自会话事件（`run.end` 的用量、`budget.exceeded` 的超限事实）
 * 与 `y_sessions.opened`，不改任何状态。注册点在 `packages/core/src/kernel/index.ts`（本卡未放开该路径），
 * 前端渲染与「超限红点」留给控制台卡。
 */
export function budgetView(host: { db: Db; config: YonderConfig }): { decl: ViewDecl; provider: ViewProvider } {
	const decl: ViewDecl = {
		id: budgetViewId,
		plugin: "core",
		title: "预算",
		placement: "rail",
		scope: "session",
	};
	const provider: ViewProvider = {
		async data(session) {
			if (!session) throw new Error("Session required");
			const limits = host.config.budget;
			const state: BudgetState = await budgetState(host.db, session);
			const exceeded = await host.db.all<{ data: string }>(
				"SELECT data FROM y_events WHERE type = ? AND json_extract(data, '$.session') = ?",
				budgetEventType,
				session,
			);
			return {
				viewId: decl.id,
				rev: state.wakeups + exceeded.length,
				...(exceeded.length ? { badge: exceeded.length } : {}),
				content: {
					type: "kv",
					rows: [
						{ k: "Token", v: value(state.tokens, limits?.tokens, "") },
						{ k: "时长（分钟）", v: value(Math.round(state.minutes), limits?.maxMinutes, "") },
						{ k: "唤醒", v: value(state.wakeups, limits?.maxWakeups, " 次") },
						{ k: "超限处理", v: limits?.overBudget === "stop" ? "stop（首版仍只记录）" : "record（只记录）" },
					],
				},
			};
		},
	};
	return { decl, provider };
}
