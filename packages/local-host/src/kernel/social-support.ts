import { projectConversationOperability } from "@yonder/bot-core/kernel/operability";
import { membershipGroup } from "@yonder/bot-core/routing/platform-group.js";
import { requestSources } from "@yonder/bot-core/tools/parent-origin.js";
import type { Store } from "@yonder/local-host/store/index";
import type { Channel, Hook, SocialPolicy, ToolContext } from "@yonder/sdk";
import type { AgentConfig } from "../config/index.js";

export function createSocialSupport(
	store: Store,
	agents: Map<string, AgentConfig>,
	channels: Map<string, Channel>,
	hooks: ReadonlyMap<string, readonly Hook[]> = new Map(),
	configStatus?: (
		agentId: string,
	) => Promise<{ agent?: { state: string; revision?: string; acceptedRevision?: string } } | undefined>,
) {
	return {
		ownerInput: async (agent: string, caller: ToolContext) => {
			if (!caller.agent || !caller.event?.id) return false;
			const session = await store.sessions.get(caller.session);
			if (!session || session.agent !== caller.agent) return false;
			const sources = await requestSources(
				store,
				session,
				[...(caller.events ?? []), caller.event].map((event) => event.id),
			);
			return (
				!!sources?.length &&
				(
					await Promise.all(
						sources.map(
							async (event) => !!event.from && (await store.identity().relation(agent, event.from)) === "owner",
						),
					)
				).every(Boolean)
			);
		},
		inspectRoute: async (
			agentId: string,
			conv: string,
			requestedEvent: string | undefined,
			policy: SocialPolicy,
			candidate?: AgentConfig,
		) => {
			const agent = candidate ?? agents.get(agentId);
			if (!agent)
				return {
					detail: "unknown: Agent is unavailable",
					capabilityGaps: ["unknown: Agent is unavailable"],
					policySource: "unknown: Agent is unavailable",
					operability: { status: "unknown" as const, reason: "Agent is unavailable" },
				};
			const [fact, config] = await Promise.all([
				projectConversationOperability({
					agent,
					agents: [...agents.values()].map((item) => (item.id === agentId ? agent : item)),
					selector: { conv, ...(requestedEvent ? { eventId: requestedEvent } : {}) },
					store,
					channels,
					hooks,
					batchRequested: policy.mode === "batch" && policy.batch?.run === true,
				}),
				configStatus?.(agentId) ?? Promise.resolve(undefined),
			]);
			const history = fact.history;
			const gaps = fact.status === "unknown" ? [fact.reason ?? "unknown: no trusted sample"] : [];
			const instance = conv.split(":")[1];
			const channel = channels.get(instance ?? "");
			if (fact.status === "observed" && !channel)
				gaps.push(`unknown: channel instance ${instance ?? "?"} is not loaded`);
			else if (fact.status === "observed" && channel && !channel.features)
				gaps.push(`unknown: channel capabilities for ${instance} are not declared`);
			if (fact.status === "observed" && !history?.participation)
				gaps.push("unknown: effective participation policy is not recorded for the sample event");
			const policySource = history?.participation?.revision
				? `historical routing.social-decision; revision=${history.participation.revision}; reason=${history.participation.reason ?? "unknown"}; plugin=${history.participation.plugin ?? "unknown"}${history.participation.consumerIssue ? `; batch consumer missing (${history.participation.consumerIssue}, profile=${history.participation.profile ?? "unknown"}); ${history.participation.repair ?? "inspect source profile and exact-conversation batch binding"}` : ""}`
				: "unknown: runtime policy not recorded for sample event; displayed policy is configured merge only";
			if (policy.mode === "mention" && policy.signals?.botMention === "respond") {
				if (!channel?.features?.mentions)
					gaps.push(`unknown: inbound bot mention capability for ${instance ?? "?"} is not declared`);
				else if (!channel.features.mentions.includes("bot"))
					gaps.push(`channel ${instance} does not report bot mentions`);
			}
			return {
				detail: JSON.stringify({
					status: fact.status,
					reason: fact.reason,
					history,
					prediction: fact.prediction,
					selector: fact.selector,
				}),
				capabilityGaps: gaps,
				policySource,
				operability: {
					status: fact.status,
					...(fact.reason ? { reason: fact.reason } : {}),
					...(fact.sample ? { sample: fact.sample } : {}),
					...(fact.history ? { history: fact.history } : {}),
					...(fact.prediction ? { prediction: fact.prediction } : {}),
				},
				...(config?.agent ? { acceptedConfiguration: config.agent } : {}),
			};
		},
	};
}

/** Resolve only the platform facts attached by a registered channel. */
export async function socialTarget(
	store: Store,
	agents: Map<string, AgentConfig>,
	channels: Map<string, Channel>,
	conv: string,
) {
	const events = (await store.events.query({ type: "message.in", conv, limit: 1000 })).events;
	const event = events.find((item) =>
		["dm", "group", "channel"].includes(String((item.data as { kind?: unknown }).kind)),
	);
	if (!event) return;
	const data = event.data as { kind: "dm" | "group" | "channel"; target?: string };
	const bot = data.target ? agents.get(data.target) : undefined;
	const person = event.from ? (await store.identity().account(event.from))?.person : undefined;
	return {
		kind: data.kind,
		...(event.from ? { from: event.from } : {}),
		...(person ? { person } : {}),
		...(bot && membershipGroup(bot, event, channels.get(conv.split(":")[1]!)) ? { membership: bot.id } : {}),
	};
}
