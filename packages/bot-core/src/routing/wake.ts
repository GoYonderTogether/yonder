type Decision = { run: boolean; reason: string } | undefined;

/** True when participation policy refuses to let this message reach the Agent at all. */
export function policyDrops(decision: Decision, ownerMention: boolean) {
	return !!decision && !decision.run && decision.reason !== "batch" && decision.reason !== "folded" && !ownerMention;
}

/** Whether an admitted message stores only ("write") or also wakes a run. Shared by routing and operability. */
export function wakeFor(
	decision: Decision,
	ownerMention: boolean,
	bindingWake: string | undefined,
	mentioned: boolean,
): "run" | "write" {
	if (decision?.reason === "batch" || decision?.reason === "folded" || ownerMention) return "write";
	if (bindingWake === "write" || (bindingWake === "mention" && !mentioned)) return "write";
	return "run";
}
