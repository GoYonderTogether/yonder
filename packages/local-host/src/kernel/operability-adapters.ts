import { projectAgentOperability } from "@yonder/bot-core/kernel/agent-operability";
import {
	type AgentOperabilityFact,
	type OperabilitySelector,
	projectConversationOperability,
	type SessionOperabilityFact,
} from "@yonder/bot-core/kernel/operability";
import type { Store } from "@yonder/local-host/store/index";
import type { RuntimeSessionConfig } from "@yonder/runtime-adapter/types";
import { type Channel, type Hook, parseRef } from "@yonder/sdk";
import type { AgentConfig } from "../config/index.js";

type ConfigStatus = { agent?: { state: string; revision?: string; acceptedRevision?: string } } | undefined;
type Loaded = { channels: Map<string, Channel>; hooks: ReadonlyMap<string, readonly Hook[]> };

/** One shape for the configuration fact; callers differ only in basis, revisions and the state fallback. */
function configurationOf(
	status: ConfigStatus,
	input: {
		basis?: "accepted" | "candidate";
		revision?: string | undefined;
		diskRevision?: string | undefined;
		stateFallback?: string;
	} = {},
): NonNullable<SessionOperabilityFact["configuration"]> {
	const state = status?.agent?.state ?? input.stateFallback;
	return {
		basis: input.basis ?? "accepted",
		...(input.revision ? { revision: input.revision } : {}),
		...(input.diskRevision ? { diskRevision: input.diskRevision } : {}),
		...(status?.agent?.acceptedRevision ? { acceptedRevision: status.agent.acceptedRevision } : {}),
		...(state ? { state } : {}),
	};
}

const unavailableAgent = (): AgentOperabilityFact => ({
	status: "unknown",
	limit: 20,
	truncated: false,
	conversations: [],
});

export async function extendRuntimeInspection(options: {
	result: unknown;
	agentId: string;
	agents: Map<string, AgentConfig>;
	store: Store;
	channels: Map<string, Channel>;
	hooks: ReadonlyMap<string, readonly Hook[]>;
	selector: OperabilitySelector;
	currentConfig(session: string): RuntimeSessionConfig | undefined;
	configStatus(agentId: string): Promise<{ agent?: { state: string; revision?: string; acceptedRevision?: string } }>;
}) {
	const { agentId, agents, store } = options;
	const agent = agents.get(agentId);
	if (!agent) throw new Error(`Unknown agent: ${agentId}`);
	const [status, sessions] = await Promise.all([
		options.configStatus(agentId),
		store.sessions.list({ agent: agentId, open: true }),
	]);
	const configuration = configurationOf(status, {
		revision: status.agent?.acceptedRevision,
		diskRevision: status.agent?.revision,
	});
	const operability = await projectAgentOperability({
		agent,
		agents: agents.values(),
		selector: options.selector,
		store,
		channels: options.channels,
		hooks: options.hooks,
		configuration,
	});
	const runningSnapshots = sessions.flatMap((session) => {
		const snapshot = options.currentConfig(session.id);
		return snapshot
			? [
					{
						session: session.id,
						profile: snapshot.profile,
						model: snapshot.resolved.model,
						capabilities: snapshot.resolved.capabilities,
					},
				]
			: [];
	});
	return { ...(options.result as object), runningSnapshots, operability };
}

export function managementOperabilityProjector(options: {
	agents: Map<string, AgentConfig>;
	store: Store;
	loaded: Loaded;
	configStatus(agentId: string): Promise<{ agent?: { state: string; acceptedRevision?: string } } | undefined>;
}) {
	return async (
		agentId: string,
		input: {
			config: unknown;
			agents: Map<string, AgentConfig>;
			basis: "accepted" | "candidate";
			revision?: string;
		},
	): Promise<AgentOperabilityFact> => {
		const agent = input.agents.get(agentId);
		if (!agent) return unavailableAgent();
		const status = await options.configStatus(agentId);
		return projectAgentOperability({
			agent,
			agents: input.agents.values(),
			store: options.store,
			channels: options.loaded.channels,
			hooks: options.loaded.hooks,
			configuration: configurationOf(status, {
				basis: input.basis,
				revision: input.basis === "accepted" ? status?.agent?.acceptedRevision : input.revision,
				diskRevision: input.basis === "accepted" ? input.revision : undefined,
			}),
		});
	};
}

export function conversationOperabilityProjector(options: {
	agents: Map<string, AgentConfig>;
	store: Store;
	loaded: Loaded;
	configStatus(agentId: string): Promise<ConfigStatus>;
}) {
	return async (agentId: string, selector: OperabilitySelector) => {
		const agent = options.agents.get(agentId);
		if (!agent) return { status: "unknown" as const, selector, reason: "source Agent is unavailable" };
		const status = await options.configStatus(agentId);
		return projectConversationOperability({
			agent,
			agents: options.agents.values(),
			selector,
			store: options.store,
			channels: options.loaded.channels,
			hooks: options.loaded.hooks,
			configuration: configurationOf(status, {
				revision: status?.agent?.acceptedRevision,
				diskRevision: status?.agent?.revision,
				stateFallback: "unknown",
			}),
		});
	};
}

export function agentOperabilityProjector(options: {
	agents: Map<string, AgentConfig>;
	store: Store;
	loaded: Loaded;
	configStatus(agentId: string): Promise<ConfigStatus>;
}) {
	return async (agentId: string): Promise<AgentOperabilityFact> => {
		const agent = options.agents.get(agentId);
		if (!agent) return unavailableAgent();
		const status = await options.configStatus(agentId);
		return projectAgentOperability({
			agent,
			agents: options.agents.values(),
			store: options.store,
			channels: options.loaded.channels,
			hooks: options.loaded.hooks,
			configuration: configurationOf(status, {
				revision: status?.agent?.acceptedRevision,
				diskRevision: status?.agent?.revision,
				stateFallback: "unknown",
			}),
		});
	};
}

/** Owner-main-only wrapper: enriches at most the eight summary-visible, observed group bindings. */
export function ownerAgentOperabilityProjector(options: {
	agents: Map<string, AgentConfig>;
	store: Store;
	loaded: Loaded;
	configStatus(agentId: string): Promise<ConfigStatus>;
}) {
	const project = agentOperabilityProjector(options);
	return async (agentId: string, signal?: AbortSignal): Promise<AgentOperabilityFact> => {
		const report = await project(agentId);
		await Promise.all(
			(report.conversations ?? []).slice(0, 8).map(async (fact) => {
				if (fact.sample?.kind !== "group" || !fact.selector.conv) return;
				let reason = "platform description unsupported";
				try {
					const ref = parseRef(fact.selector.conv);
					const channel = ref.kind === "conv" ? options.loaded.channels.get(ref.channel) : undefined;
					if (!channel) reason = "channel instance unavailable";
					else if (!channel.describeConversation) reason = "platform description unsupported";
					else {
						const label = await channel.describeConversation(fact.selector.conv, signal);
						fact.conversationLabel =
							label?.kind && label.kind !== fact.sample.kind
								? { status: "unknown", reason: "platform kind does not match observed conversation kind" }
								: label?.displayName.trim()
									? {
											status: "observed",
											displayName: label.displayName.trim(),
											...(label.kind ? { kind: label.kind } : {}),
											basis: "platform-exact",
										}
									: { status: "unknown", reason: signal?.aborted ? "request aborted" : "platform label unavailable" };
						return;
					}
				} catch {
					reason = signal?.aborted ? "request aborted" : "platform description failed";
				}
				fact.conversationLabel = { status: "unknown", reason };
			}),
		);
		return report;
	};
}

export function extendKernelInspection(options: {
	result: unknown;
	request: { agent?: string; conv?: string; eventId?: string };
	agents: Map<string, AgentConfig>;
	store: Store;
	loaded: Loaded;
	currentConfig(session: string): RuntimeSessionConfig | undefined;
	configStatus(agentId: string): Promise<{ agent?: { state: string; revision?: string; acceptedRevision?: string } }>;
}) {
	return extendRuntimeInspection({
		result: options.result,
		agentId: options.request.agent ?? "main",
		agents: options.agents,
		store: options.store,
		channels: options.loaded.channels,
		hooks: options.loaded.hooks,
		selector: {
			...(options.request.conv ? { conv: options.request.conv } : {}),
			...(options.request.eventId ? { eventId: options.request.eventId } : {}),
		},
		currentConfig: options.currentConfig,
		configStatus: options.configStatus,
	});
}
