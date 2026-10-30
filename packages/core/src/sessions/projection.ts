import type { SessionInfo, SessionsAPI } from "@yonder/sdk";
import type { AgentConfig } from "../config/index.js";
import type { Runtime } from "../runtime/index.js";
import type { Store } from "../store/index.js";
import { cleanTitle } from "./titles.js";

export function sessionProjection(store: Store, runtime: () => Runtime, agents: Map<string, AgentConfig>) {
	async function withPolicy(row: SessionInfo, firstInputs?: Map<string, string>): Promise<SessionInfo> {
		if (row.mode !== "task") return row;
		const input = row.title ? undefined : (firstInputs ?? (await store.events.firstTaskInputs([row.id]))).get(row.id);
		const title = row.title || cleanTitle(input ?? "");
		return { ...row, close: (await runtime().sessionState(row.id))?.close ?? "run-end", ...(title ? { title } : {}) };
	}
	const list: SessionsAPI["list"] = async (filter) => {
		const rows = (await store.sessions.list(filter)).filter(
			(row) => !row.agent || row.mode === "task" || (agents.has(row.agent) && !agents.get(row.agent)?.archivedAt),
		);
		const firstInputs = await store.events.firstTaskInputs(
			rows.filter((row) => row.mode === "task" && !row.title).map((row) => row.id),
		);
		return Promise.all(rows.map((row) => withPolicy(row, firstInputs)));
	};
	return { withPolicy, list };
}
