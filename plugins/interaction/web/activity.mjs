// Presentation only. Runtime execution facts and caller-visible task counts stay separate.
export function activitySummary(value) {
	if (value?.schemaVersion !== 1 || !Number.isSafeInteger(value.sourceRevision) || value.sourceRevision < 0)
		return { availability: "unavailable" };
	if (value.availability === "unpublished") return { ...value, summary: undefined };
	if (
		value.availability !== "available" ||
		value.summary?.schemaVersion !== 1 ||
		!Number.isFinite(value.summary.observedAt) ||
		!Array.isArray(value.summary.agents) ||
		!value.summary.agents.every(
			(agent) =>
				agent !== null &&
				typeof agent === "object" &&
				typeof agent.agentId === "string" &&
				[agent.blocked, agent.review, agent.waitingUser].every((count) => Number.isSafeInteger(count) && count >= 0),
		)
	)
		return { availability: "unavailable", sourceRevision: value.sourceRevision };
	return value;
}
export function presentActivity(agent, known, envelope) {
	const source = activitySummary(envelope);
	const counts =
		source.availability === "available"
			? (source.summary.agents.find((item) => item.agentId === agent.id) ?? { blocked: 0, review: 0, waitingUser: 0 })
			: null;
	const phases = (agent.tasks ?? []).map((task) => task.execution?.phase);
	// Legacy hosts have no execution field. Preserve their three-state execution signal.
	const running =
		phases.includes("running") ||
		(agent.state === "running" && !phases.length) ||
		(agent.state === "running" && phases.some((phase) => phase === undefined));
	const retrying = phases.includes("retrying");
	const waitingInput =
		phases.includes("waiting-input") || (agent.state === "waiting" && (!phases.length || phases.includes(undefined)));
	const executionKnown =
		known &&
		phases.every(
			(phase) => phase === undefined || ["running", "retrying", "waiting-input", "blocked", "idle"].includes(phase),
		);
	let state = "idle",
		label = "无执行";
	if (!executionKnown) {
		state = "unknown";
		label = "执行状态未知";
	} else if (running || retrying) {
		state = "running";
		label = running ? `运行中${retrying ? " · 重试中" : ""}` : "重试中";
	} else if (waitingInput) {
		state = "waiting";
		label = "等你输入";
	} else if (phases.includes("blocked")) {
		state = "blocked";
		label = "执行受阻";
	} else if (counts?.blocked > 0) {
		state = "blocked";
		label = "有阻塞事项";
	} else if (counts?.review > 0) {
		state = "review";
		label = "待检查";
	} else if (counts?.waitingUser > 0) {
		state = "waiting";
		label = "等你";
	}
	const items = counts
		? [
				counts.blocked && `阻塞 ${counts.blocked}`,
				counts.review && `待检查 ${counts.review}`,
				counts.waitingUser && `等你 ${counts.waitingUser}`,
			]
				.filter(Boolean)
				.join(" · ")
		: source.availability === "unpublished"
			? "事项状态未接入"
			: "事项状态暂不可用";
	return { state, label, items, emphasized: executionKnown && (running || retrying), counts };
}
