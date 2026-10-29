import type { SessionInfo } from "@yonder/sdk";
import type { AgentConfig, YonderConfig } from "../config/index.js";
import type { Store } from "../store/index.js";
import type { BotOverview } from "./workbench.js";

/** Channels a Bot is bound to, plus the sub-sessions hanging under it (contracts §18 `bots.overview`). */
export function botOverview(
	config: YonderConfig,
	agents: Map<string, AgentConfig>,
	store: Store,
	withPolicy: (row: SessionInfo) => Promise<SessionInfo>,
) {
	return async (agentId: string): Promise<BotOverview> => {
		const agent = agents.get(agentId);
		const channels = Object.entries(config.channels ?? {})
			.filter(([channel]) =>
				agent?.bindings.some(
					(b) =>
						(b.match.type === undefined || b.match.type === "message.in") &&
						(!b.match.channel || [b.match.channel].flat().includes(channel)),
				),
			)
			.map(([id, c]) => ({ id, label: id, kind: c.type }));
		const rows = await store.sessions.list({ agent: agentId });
		return { channels, sessions: await Promise.all(rows.map(withPolicy)) };
	};
}
