// Display-only projections. Never infer a project from a title or execution from ledger state.
export const endedTask = (task) => task.state === "done" || task.state === "cancelled";
export function panelGroups(tasks, mode = "bot") {
	const unique = new Map(tasks.map((task) => [task.id, task]));
	const groups = new Map();
	for (const task of unique.values()) {
		let root = task;
		const seen = new Set([task.id]);
		if (mode === "matter") {
			while (unique.has(root.parent) && !seen.has(root.parent)) {
				root = unique.get(root.parent);
				seen.add(root.id);
			}
		}
		const key = mode === "bot" ? (task.ownerAgent ?? "temporary-worker") : root.id;
		if (!groups.has(key)) groups.set(key, { key, root, tasks: [] });
		groups.get(key).tasks.push(task);
	}
	return [...groups.values()]
		.map((group) => ({
			...group,
			tasks: group.tasks.sort((a, b) => Number(endedTask(a)) - Number(endedTask(b))),
			ended: group.tasks.every(endedTask),
		}))
		.sort((a, b) => Number(a.ended) - Number(b.ended));
}
export function panelState(task) {
	return (
		{
			open: "未开始",
			active: "进行中",
			review: "待检查",
			blocked: "受阻",
			"waiting-user": task.progress ? "需要你" : "待补充",
			done: "已完成",
			cancelled: "已取消",
		}[task.state] ?? "状态未知"
	);
}
export function shortPanelText(value, limit = 180) {
	const text = String(value ?? "")
		.replace(/\s+/g, " ")
		.trim();
	return text.length > limit ? `${text.slice(0, limit)}…` : text;
}
