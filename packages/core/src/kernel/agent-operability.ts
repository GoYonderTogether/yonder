import type { Channel, Hook } from "@yonder/sdk";
import type { AgentConfig } from "../config/index.js";
import type { Store } from "../store/index.js";
import {
	type AgentOperabilityFact,
	type OperabilitySelector,
	projectConversationOperability,
	type SessionOperabilityFact,
} from "./operability.js";

const exactConversations = (agent: AgentConfig) => [
	...new Set(
		agent.bindings.flatMap((binding) => {
			const conv = binding.match.conv;
			return typeof conv === "string" ? [conv] : (conv ?? []);
		}),
	),
];

export async function projectAgentOperability(options: {
	agent: AgentConfig;
	agents: Iterable<AgentConfig>;
	selector?: OperabilitySelector;
	store?: Store;
	channels?: Map<string, Channel>;
	hooks?: ReadonlyMap<string, readonly Hook[]>;
	configuration?: SessionOperabilityFact["configuration"];
}): Promise<AgentOperabilityFact> {
	const limit = 20;
	const { store, channels, hooks } = options;
	if (!store || !channels || !hooks)
		return {
			status: "unknown",
			limit,
			truncated: false,
			conversations: [
				{ status: "unknown", selector: options.selector ?? {}, reason: "runtime session evidence is unavailable" },
			],
		};
	const selector = options.selector ?? {};
	const agents = [...options.agents];
	const convs =
		selector.conv || selector.eventId
			? [selector.conv].filter((item): item is string => !!item)
			: exactConversations(options.agent).slice(0, limit);
	const unique = [...new Set(convs)];
	const truncated = !selector.conv && !selector.eventId && exactConversations(options.agent).length > limit;
	const conversations = await Promise.all(
		unique.map((conv) =>
			projectConversationOperability({
				agent: options.agent,
				agents,
				selector: { conv, ...(selector.eventId ? { eventId: selector.eventId } : {}) },
				store,
				channels,
				hooks,
				configuration: options.configuration,
			}),
		),
	);
	if (selector.eventId && !selector.conv) {
		const fact = await projectConversationOperability({
			agent: options.agent,
			agents,
			selector,
			store,
			channels,
			hooks,
			configuration: options.configuration,
		});
		if (fact.selector.conv) conversations.push(fact);
		else
			conversations.push({
				status: "unknown",
				selector,
				reason: "event is not a stored message.in with a conversation",
			});
	}
	return {
		status: conversations.some((item) => item.status === "observed") ? "observed" : "unknown",
		limit,
		truncated,
		...(!unique.length && !selector.eventId ? { reason: "agent has no exact-conversation source bindings" } : {}),
		conversations,
	};
}
