import { type Decision, type Ledger, type Task, verifyDecision } from "./ledger.js";

export interface DecisionEngineOptions {
	ledger: Ledger;
	decide(snapshot: Readonly<Task>): Promise<unknown>;
	send(boundTarget: string, text: string): Promise<"sent" | "failed" | "unknown">;
	boundTarget: string;
	minimumIntervalMs: number;
}

/** Pure orchestration boundary: delivery is injected; ambiguous receipts are never retried. */
export async function runDecision(
	options: DecisionEngineOptions,
	taskId: string,
	now = Date.now(),
): Promise<Decision | null> {
	const task = (await options.ledger.list()).find((item) => item.id === taskId);
	if (!task) throw new Error("unknown task");
	if (
		(task.quietUntil && now < task.quietUntil) ||
		(task.lastSent !== undefined && now - task.lastSent < options.minimumIntervalMs)
	)
		return null;
	if (task.delivery === "unknown" || (task.attempt && task.delivery !== "sent" && task.delivery !== "failed"))
		return null;
	const raw = await options.decide(structuredClone(task));
	if (!verifyDecision(raw, task, now)) return null;
	const decision = raw as Decision;
	if (decision.decision === "skip") return decision;
	// Ask only goes to the explicitly supplied bound target; no owner is inferred here.
	if (!options.boundTarget) return null;
	await options.ledger.decision(taskId, decision, now); // durable claim before crossing the delivery boundary
	let receipt: "sent" | "failed" | "unknown";
	try {
		receipt = await options.send(options.boundTarget, decision.text);
	} catch {
		receipt = "unknown";
	}
	await options.ledger.receipt(taskId, receipt);
	return decision;
}
