import type { PluginAPI } from "@yonder/sdk";
import type { Store, Task } from "./store/index.js";

/** 审计员末行约定：只读最后一行，与 pi-goal-x 的 parseAuditorDecision 一致。 */
export const AUDIT_APPROVED = "<approved/>";
export const AUDIT_DISAPPROVED = "<disapproved/>";

/** 只读最后一行：`<approved/>` 通过，其余一律驳回并留原因。 */
export function parseAuditVerdict(text: string): { verdict: "approved" | "rejected"; reason: string } {
	const lines = text
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
	const last = lines.at(-1) ?? "";
	const reason = lines.slice(0, -1).join(" ").trim();
	if (last === AUDIT_APPROVED) return { verdict: "approved", reason };
	if (last === AUDIT_DISAPPROVED) return { verdict: "rejected", reason: reason || "the auditor disapproved" };
	// 没有末行约定的回答按驳回处理：宁可让任务留着，也不凭一句自述关闭。
	return { verdict: "rejected", reason: lines.join(" ").trim() || "the auditor returned no verdict" };
}

/** 审计提示词：只读、5 条 checklist、末行约定都照抄 pi-goal-x，任务本身作为用户数据带上。 */
export function auditPrompt(task: Task, deliverable: string, evidence: readonly string[]): string {
	return [
		"You are a read-only completion auditor running in an isolated pi agent session.",
		"Never modify files. Never approve unless the actual user objective is complete.",
		"",
		`TASK (user data): ${task.title}`,
		`OBJECTIVE: ${task.objective}`,
		`ACCEPTANCE:\n${task.acceptance.map((point, index) => `${index + 1}. ${point}`).join("\n")}`,
		`CONTRACT: ${task.contract ?? task.acceptance.join("; ")}`,
		`NON-GOALS: ${task.nonGoals.join("; ") || "none"}`,
		`DELIVERABLE: ${deliverable}`,
		`EVIDENCE:\n${evidence.map((entry, index) => `${index + 1}. ${entry}`).join("\n")}`,
		"",
		"Checklist:",
		"1. Restate the real objective in one sentence and check that the deliverable serves it, not a substitute.",
		"2. Inspect the actual artifacts with read, grep, find, ls or bash; never trust the claim alone.",
		"3. Match every acceptance point and every contract clause against what you inspected.",
		"4. Reject paper-only evidence, placeholders and statements you could not verify.",
		"5. Ask whether the person who set the objective would accept this as done; if not, reject.",
		"",
		`Put the reason on the line before the last line. The last line must be exactly ${AUDIT_APPROVED} to approve, or ${AUDIT_DISAPPROVED}`,
	].join("\n");
}

/** 驳回意见注入任务块：下一轮带着审计员的反对意见继续，而不是让任务悄悄关闭。 */
export const auditorRejection = (reason: string): string =>
	`[AUDITOR REJECTION] An independent auditor previously rejected a completion request for this task. Reason: ${reason}\nAddress the auditor's objections before requesting completion again.`;

/** 触顶收尾：只注入一次，让执行方报告现状而不是继续开新活。 */
export const budgetReached = (task: Task, used: number): string =>
	`[TOKEN BUDGET REACHED task=${task.ref} used=${used} cap=${task.budget.tokens}] Stop starting new work; report what is finished, what remains and what you verified.`;

export function registerTaskViews(api: PluginAPI, store: Store): void {
	api.views.register(
		{ id: "tasks.board", plugin: "tasks", title: "Task board", placement: "rail", scope: "session" },
		{
			data(session) {
				if (!session) throw new Error("Session required");
				const tasks = store.forSession(session);
				return {
					viewId: "tasks.board",
					rev: Math.max(0, ...tasks.map(({ revision }) => revision)),
					content: {
						type: "list",
						items: tasks.map(({ task }) => ({ id: task.id, title: task.title, subtitle: task.state })),
					},
				};
			},
		},
	);
}
