import type { Ref, YEvent } from "@yonder/sdk";
import type { AgentConfig } from "../config/index.js";
import type { Store } from "../store/index.js";
import { CONSOLE, isConsoleBot } from "./console.js";

type Emit = (event: { type: string; from: Ref; conv: Ref; data: Record<string, unknown> }) => Promise<YEvent>;
type Log = (level: "info" | "warn" | "error", message: string) => void;

/**
 * Console → resident Bots (contracts §10). A node has one owner: the first console Bot's. Only Bots of that
 * owner are listed or reachable; every other Bot gets one warning. The console peer is linked to that owner
 * so `from: owner` holds (02 §4.1).
 */
export async function createBots(agents: Map<string, AgentConfig>, store: Store, emit: Emit, log: Log) {
	const account = `acct:${CONSOLE}:owner`;
	const owner = [...agents.values()].find(isConsoleBot)?.owner;
	const bots = () => [...agents.values()].filter((agent) => isConsoleBot(agent) && agent.owner === owner);
	for (const agent of agents.values())
		if (isConsoleBot(agent) && agent.owner !== owner)
			log("warn", `Bot ${agent.id} 的 owner ${agent.owner} 不是本节点 owner ${owner}，控制台不会列出它`);
	if (owner && !(await store.identity().account(account)) && (await store.identity().person(owner)))
		await store.identity().link(account, owner);
	return {
		list: async () =>
			Promise.all(
				bots().map(async (agent) => ({
					agent: agent.id,
					name: agent.name,
					...(agent.work ? { work: agent.work } : {}),
					session: (await store.sessions.list({ agent: agent.id, open: true })).find(
						(session) => session.mode === "main",
					)?.id,
				})),
			),
		/** A normal message.in on the console channel; the agent's own binding decides everything else. */
		send: async (agent: string, text: string) => {
			const bot = agents.get(agent);
			if (!bot || !bots().includes(bot)) throw new Error(`Unknown bot: ${agent}`);
			const event = await emit({
				type: "message.in",
				from: account as Ref,
				conv: `conv:${CONSOLE}:${agent}` as Ref,
				data: { kind: "dm", text, target: agent },
			});
			const route = event.routes?.find((item) => item.agent === agent);
			if (!route?.session) throw new Error(`Bot ${agent} did not accept the message (${route?.dropped ?? "no route"})`);
			return { event: event.id, session: route.session };
		},
	};
}
