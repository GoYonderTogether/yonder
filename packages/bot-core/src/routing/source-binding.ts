import type { AgentConfig, Binding } from "@yonder/bot-definition";
import type { YEvent } from "@yonder/sdk";
import type { Store } from "../store/contracts.js";
import { matches } from "./matching.js";

/** The same ordered first match drives both participation defaults and the stored route. */
export async function resolveSourceBindings(
	event: YEvent,
	agents: Iterable<AgentConfig>,
	store: Store,
	internalTarget?: string,
	kind?: unknown,
) {
	const bindings = new Map<string, Binding | undefined>();
	for (const agent of agents) {
		let source: Binding | undefined;
		for (const candidate of agent.bindings)
			if (
				!(internalTarget && kind === "parent-request" && candidate.session !== "main") &&
				(await matches(candidate, event, agent, store))
			) {
				source = candidate;
				break;
			}
		bindings.set(agent.id, source);
	}
	return bindings;
}
