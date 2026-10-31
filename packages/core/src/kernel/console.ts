import type { Channel } from "@yonder/sdk";
import { type AgentConfig, type Binding, CONSOLE, CONSOLE_BINDING, type YonderConfig } from "../config/index.js";

// The console identity and its instance-scope predicates are pure configuration facts; they live at L0 in
// config/console.ts so delivery, routing and tools can read them without importing this composition module.
export {
	allowsChannelInstance,
	assertChannelInstance,
	CONSOLE,
	CONSOLE_BINDING,
	isConsoleBot,
} from "../config/index.js";

/**
 * Built-in channel for the web console. Inbound messages are emitted by the kernel on behalf of the
 * authenticated owner (bots.send); replies are recorded as normal message.out and reach the console as
 * session events, so `send`/`stream` only acknowledge. The console is not a transport of its own.
 */
export function consoleChannel(): Channel {
	return {
		id: CONSOLE,
		kinds: ["dm"],
		output: { stream: true, attachments: false },
		multiAgent: true,
		start: async () => {},
		stop: async () => {},
		send: async () => ({ ok: true }),
		stream: async (_conv, out) => {
			for await (const _part of out);
			return { ok: true };
		},
	};
}

/** A resident Bot is an agent that has a `main` session binding. */
const mainBinding = (agent: AgentConfig): Binding | undefined =>
	agent.bindings.find((binding) => binding.session === "main" && binding.wake !== "write");

/**
 * Zero-config console entry: while the gateway is enabled, every resident Bot gets an owner-only
 * binding from the console into its single `main` session (02 §1.1), using the profile of its existing
 * main binding (02 §2.4). An explicit binding on the console channel in agent.yaml wins.
 */
export function withConsoleBinding(agent: AgentConfig, config: YonderConfig): AgentConfig {
	if (config.gateway?.enabled === false || agent.archivedAt) return agent;
	if (agent.bindings.some((binding) => [binding.match.channel].flat().includes(CONSOLE))) return agent;
	const main = mainBinding(agent);
	if (!main) return agent;
	const binding: Binding = {
		id: CONSOLE_BINDING,
		match: { channel: CONSOLE, kind: "dm", from: "owner" },
		session: "main",
		profile: main.profile ?? agent.defaultProfile,
	};
	return { ...agent, bindings: [binding, ...agent.bindings] };
}

/** The implicit binding is runtime-only: never persist it into agent.yaml. */
export const withoutConsoleBinding = (agent: AgentConfig): AgentConfig => ({
	...agent,
	bindings: agent.bindings.filter((binding) => binding.id !== CONSOLE_BINDING),
});

/**
 * Platform-group bindings (`@platform-group:<instance>`) are installed at runtime by workspace loading and are
 * never stored in agent.yaml; `agents.update` must drop them for the same reason as the console binding.
 */
export const withoutRuntimeBindings = (agent: AgentConfig): AgentConfig => ({
	...agent,
	bindings: agent.bindings.filter(
		(binding) => binding.id !== CONSOLE_BINDING && !binding.id.startsWith("@platform-group:"),
	),
});
