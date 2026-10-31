import { CONSOLE } from "./console.js";
import type { AgentConfig } from "./schema.js";

// Console identity and its instance-scope predicates live in config/console.ts; the binding-shape predicates
// that depend on a full agent config live here, still at L0 (architecture §6).
export { allowsChannelInstance, assertChannelInstance, CONSOLE, CONSOLE_BINDING } from "./console.js";

/** Whether a binding targets the built-in console channel. */
const onConsole = (binding: AgentConfig["bindings"][number]): boolean =>
	[binding.match.channel].flat().includes(CONSOLE);

/** A resident Bot is an agent with a live binding into the built-in console channel. */
export const isConsoleBot = (agent: AgentConfig): boolean => !agent.archivedAt && agent.bindings.some(onConsole);

const matchesAgent = (value: string | string[] | undefined) =>
	value === undefined || (Array.isArray(value) ? value.includes("agent") : value === "agent");

/** Whether another agent's agent_ask can reach this agent through an existing binding. */
export function canReceivePeerAsk(agent: AgentConfig): boolean {
	return agent.bindings.some((b) => matchesAgent(b.match.channel) && matchesAgent(b.match.kind));
}
