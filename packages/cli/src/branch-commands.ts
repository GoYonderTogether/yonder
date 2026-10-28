import type { SessionInfo } from "@yonder/sdk";

export async function branchCommand(
	name: string,
	id: string,
	call: <T>(method: string, params?: object) => Promise<T>,
	choose: (heading: string, options: string[]) => Promise<string | undefined>,
	switchSession: (id: string) => Promise<void>,
	notice: (text: string) => void,
) {
	if (name === "tree") {
		const branches = await call<Array<{ id: string; parent?: string; at?: number }>>("sessions.tree", { id });
		const labels = branches.map(
			(branch) =>
				`#${branch.id}${branch.parent ? ` ← #${branch.parent} @ ${branch.at}` : ""}${branch.id === id ? " · 当前" : ""}`,
		);
		const selected = await choose("分支 · Branches（已执行的工具副作用不会回滚）", labels);
		const branch = selected ? branches[labels.indexOf(selected)] : undefined;
		if (branch && branch.id !== id) await switchSession(branch.id);
		return;
	}
	const requested = name.split(/\s+/)[1];
	const page = await call<{ items: Array<{ id: number; kind: string; text: string }>; hasMore: boolean }>(
		"sessions.transcript",
		{ id, limit: 500 },
	);
	const labels = page.items.map(
		(entry) => `#${entry.id} · ${entry.kind} · ${entry.text.replace(/\s+/g, " ").slice(0, 100)}`,
	);
	const selected = requested
		? undefined
		: await choose(
				`选择历史节点后分叉 · Fork after entry${page.hasMore ? " (latest 500; /fork ID for older)" : ""}；工具副作用不会回滚`,
				labels,
			);
	const entry = selected ? page.items[labels.indexOf(selected)] : undefined;
	const at = requested ? Number(requested) : entry?.id;
	if (at !== undefined) {
		const child = await call<SessionInfo>("sessions.fork", { id, at });
		await switchSession(child.id);
		notice("已执行的工具副作用不会回滚 / Tool side effects are not rolled back");
	}
}
