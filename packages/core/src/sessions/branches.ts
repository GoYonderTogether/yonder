import { randomUUID } from "node:crypto";
import type { SessionInfo } from "@yonder/sdk";
import type { Runtime } from "../runtime/index.js";
import type { Store } from "../store/index.js";

export function createBranches(
	store: Store,
	runtime: () => Runtime,
	version: string,
	withPolicy: (row: SessionInfo) => Promise<SessionInfo>,
) {
	return {
		async tree(id: string) {
			const rows = await store.sessions.list({ mode: "task" });
			if (!rows.some((row) => row.id === id)) throw new Error(`Unknown standalone task session: ${id}`);
			const nodes = await Promise.all(
				rows.map(async (row) => {
					const parent = await runtime().forkParent(row.id);
					return { id: row.id, ...(parent ? { parent: parent.id, at: parent.at } : {}) };
				}),
			);
			const byId = new Map(nodes.map((node) => [node.id, node]));
			const root = (nodeId: string): string => {
				const parent = byId.get(nodeId)?.parent;
				return parent && byId.has(parent) ? root(parent) : nodeId;
			};
			return nodes.filter((node) => root(node.id) === root(id));
		},
		async fork(id: string, at: number) {
			const parent = await store.sessions.get(id);
			if (parent?.mode !== "task") throw new Error("Only standalone task sessions can be forked");
			const childId = await runtime().fork(id, at);
			const child: SessionInfo = {
				id: childId,
				agent: null,
				profile: parent.profile,
				mode: "task",
				key: randomUUID(),
				version,
				opened: new Date().toISOString(),
			};
			await store.sessions.put(child);
			await store.events.record({
				type: "session.open",
				data: { session: childId, mode: "task", key: child.key, profile: child.profile },
			});
			return withPolicy(child);
		},
	};
}
