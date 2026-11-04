import { batchConsumerForSource } from "@yonder/bot-core/routing/batch-consumer.js";
import { batchPlugin, participationPlugin } from "@yonder/bot-core/routing/participation.js";
import { decideParticipation } from "@yonder/bot-core/routing/social.js";
import { resolveSourceBindings } from "@yonder/bot-core/routing/source-binding.js";
import { policyDrops, wakeFor } from "@yonder/bot-core/routing/wake.js";
import type { Store } from "@yonder/bot-core/store/contracts";
import { type AgentConfig, matchesGlob, securityOf } from "@yonder/bot-definition";
import type { Channel, Hook, YEvent } from "@yonder/sdk";

export type OperabilitySelector = { conv?: string; eventId?: string };
export type SessionOperabilityFact = {
	status: "observed" | "unknown";
	selector: OperabilitySelector;
	conversationLabel?:
		| { status: "observed"; displayName: string; kind?: "dm" | "group" | "channel"; basis: "platform-exact" }
		| { status: "unknown"; reason: string };
	reason?: string;
	sample?: {
		eventId: string;
		conv: string;
		kind?: string;
		from?: string;
		relation?: "owner" | "known" | "stranger" | "unknown";
		senderIsBot?: boolean;
		mentioned?: boolean;
		nativeKind?: string;
		mentions?: { bot?: boolean; owner?: boolean; everyone?: boolean };
	};
	management?: {
		paths: ["agents.validate", "agents.update", "inspect", "agents.show"];
		authority: "existing local agent management authorization required";
	};
	history?: {
		route?: { binding: string | null; session?: string; profile?: string; wake?: string; dropped?: string };
		participation?: {
			policy?: unknown;
			reason?: string;
			plugin?: string;
			revision?: string;
			repair?: string;
			consumerIssue?: string;
			profile?: string;
		};
		execution: {
			state: "direct" | "batch" | "not-observed" | "unknown";
			runs?: Array<{ runId?: string; status?: string; path: "direct" | "batch" }>;
		};
		delivery: {
			state: "delivered" | "not-observed" | "unknown";
			receipts?: Array<{ eventId: string; session?: string }>;
		};
	};
	prediction?: {
		state: "matched" | "no-match" | "unknown";
		route?: "not-evaluated" | "dropped";
		dropReason?: "no-binding";
		binding?: string;
		profile?: string;
		wake?: string;
		participation?: { reason?: string; plugin?: string; revision?: string; run?: boolean; policy?: unknown };
		participationScope?: {
			enabled?: boolean;
			scope?: string[];
			includesConversation: boolean;
			conversationOverride?: unknown;
			defaults?: unknown;
		};
		consumer?: {
			state: "available" | "unavailable" | "not-applicable";
			reason?: string;
			binding?: string;
			issue?: string;
			profile?: string;
			plugin?: string;
			pluginSelected?: boolean;
			matchingConsumer?: boolean;
			derived?: boolean;
		};
		reply?: "auto" | "none";
		capabilities?: { plugins?: string[]; messageSend: boolean };
	};
	configuration?: {
		basis: "accepted" | "candidate";
		revision?: string;
		diskRevision?: string;
		acceptedRevision?: string;
		state?: string;
	};
};
export type AgentOperabilityFact = {
	status: "observed" | "unknown";
	limit: number;
	truncated: boolean;
	reason?: string;
	conversations: SessionOperabilityFact[];
};

async function sampleFor(store: Store, selector: OperabilitySelector): Promise<{ event?: YEvent; unknown?: string }> {
	if (selector.eventId) {
		const page = await store.events.query({
			id: selector.eventId,
			type: "message.in",
			...(selector.conv ? { conv: selector.conv } : {}),
			limit: 1,
		});
		const event = page.events[0];
		if (!event) return { unknown: "event is not a stored message.in for the selected conversation" };
		if (!event.conv) return { unknown: "message.in has no conversation" };
		return { event };
	}
	if (!selector.conv) return { unknown: "no sample selector" };
	const page = await store.events.query({ type: "message.in", conv: selector.conv, order: "desc", limit: 1 });
	const event = page.events[0];
	return event ? { event } : { unknown: "no stored message.in for the selected conversation" };
}

function routeView(event: YEvent, agentId: string, sessionProfile?: string) {
	const route = event.routes?.find((item) => item.agent === agentId);
	return route
		? {
				binding: route.binding,
				...(route.session ? { session: route.session } : {}),
				...(sessionProfile ? { profile: sessionProfile } : {}),
				...(route.wake ? { wake: route.wake } : {}),
				...(route.dropped ? { dropped: route.dropped } : {}),
			}
		: undefined;
}

export async function projectConversationOperability(options: {
	agent: AgentConfig;
	agents: Iterable<AgentConfig>;
	selector: OperabilitySelector;
	store: Store;
	channels: Map<string, Channel>;
	hooks: ReadonlyMap<string, readonly Hook[]>;
	configuration?: SessionOperabilityFact["configuration"];
	batchRequested?: boolean;
}): Promise<SessionOperabilityFact> {
	const { agent, selector, store } = options;
	if (!selector.conv && !selector.eventId)
		return { status: "unknown", selector, reason: "a conversation selector or trusted sample is required" };
	const { event, unknown } = await sampleFor(store, selector);
	if (!event) return { status: "unknown", selector, reason: unknown ?? "trusted sample unavailable" };
	if (selector.conv && selector.conv !== event.conv)
		return { status: "unknown", selector, reason: "event and conversation selectors do not match" };
	const conv = event.conv!;
	const sampleData = event.data as {
		kind?: unknown;
		senderIsBot?: unknown;
		mentioned?: unknown;
		social?: { nativeKind?: unknown; mentions?: { bot?: unknown; owner?: unknown; everyone?: unknown } };
	};
	let relation: NonNullable<SessionOperabilityFact["sample"]>["relation"];
	if (event.from?.startsWith("acct:")) {
		try {
			relation = await store.identity().relation(agent.id, event.from);
		} catch {
			relation = "unknown";
		}
	}
	const storedRoute = event.routes?.find((route) => route.agent === agent.id);
	const storedSession = storedRoute?.session ? await store.sessions.get(storedRoute.session) : undefined;
	const eventsPage = await store.events.query({ conv, after: event.id, limit: 1000 });
	const following = eventsPage.events;
	const decisions = await store.events.query({ type: "routing.social-decision", after: event.id, limit: 1000 });
	const decision = decisions.events.find(
		(item) => item.parent === event.id && (item.data as { agent?: unknown }).agent === agent.id,
	);
	const decisionData = decision?.data as
		| {
				policy?: unknown;
				reason?: string;
				plugin?: string;
				revision?: string;
				repair?: string;
				consumerIssue?: string;
				profile?: string;
		  }
		| undefined;
	const candidates = following.filter((item) => {
		if (item.type.endsWith(".batch-ready") || item.type.endsWith(".folded-ready")) {
			const plugin = item.type.endsWith(".batch-ready")
				? batchPlugin(item)
				: item.from?.startsWith("plugin:")
					? item.from.slice(7)
					: undefined;
			const data = item.data as { agent?: unknown; sourceEvents?: unknown };
			return (
				!!plugin &&
				item.type === `${plugin}.${item.type.endsWith(".batch-ready") ? "batch-ready" : "folded-ready"}` &&
				data.agent === agent.id &&
				Array.isArray(data.sourceEvents) &&
				data.sourceEvents.includes(event.id)
			);
		}
		if (item.type.endsWith(".group-batch")) {
			const plugin = item.from?.startsWith("plugin:") ? item.from.slice(7) : undefined;
			return (
				!!plugin && item.type === `${plugin}.group-batch` && (item.data as { through?: unknown }).through === event.id
			);
		}
		return false;
	});
	const paths: Array<{ id: string; session?: string; path: "direct" | "batch" }> = [];
	if (storedRoute?.session) paths.push({ id: event.id, session: storedRoute.session, path: "direct" });
	for (const batch of candidates) {
		const route = batch.routes?.find((item) => item.agent === agent.id);
		if (route?.session) paths.push({ id: batch.id, session: route.session, path: "batch" });
	}
	const runEndsPage = await store.events.query({ type: "run.end", conv, after: event.id, limit: 1000 });
	const matchedRuns = runEndsPage.events.flatMap((run) => {
		const data = run.data as { session?: unknown; runId?: unknown; inputs?: unknown; status?: unknown };
		if (typeof data.session !== "string" || !Array.isArray(data.inputs)) return [];
		const inputs = data.inputs as unknown[];
		const linked = paths
			.filter((path) => path.session === data.session && inputs.includes(path.id))
			.sort((left, right) => Number(right.path === "batch") - Number(left.path === "batch"))[0];
		return linked && run.conv === conv ? [{ event: run, data, path: linked.path, pathId: linked.id }] : [];
	});
	const sessions = await Promise.all(matchedRuns.map(({ data }) => store.sessions.get(String(data.session))));
	const validRuns = matchedRuns.filter((_, index) => sessions[index]?.agent === agent.id);
	const sent = await store.events.query({ type: "message.out", conv, after: event.id, limit: 1000 });
	const receipts = sent.events.filter((item) => {
		const data = item.data as { session?: unknown; delivery?: { ok?: unknown } };
		return (
			data.delivery?.ok === true &&
			validRuns.some(({ data: run, pathId }) => {
				return run.session === data.session && item.parent === pathId;
			})
		);
	});
	const routes =
		options.agents instanceof Map ? options.agents : new Map([...options.agents].map((item) => [item.id, item]));
	const currentAgent = routes.get(agent.id) ?? agent;
	const match = (await resolveSourceBindings(event, [currentAgent], store)).get(agent.id);
	let prediction: SessionOperabilityFact["prediction"] = match
		? { state: "matched", binding: match.id }
		: { state: "no-match" };
	if (match) {
		const profileId = match.profile ?? currentAgent.defaultProfile;
		const profile = currentAgent.profiles[profileId];
		if (!profile) prediction = { state: "unknown", binding: match.id, profile: profileId };
		else {
			const security = securityOf(profile, currentAgent.defaults);
			const plugins = profile.plugins ?? currentAgent.defaults?.plugins ?? [];
			const plugin = participationPlugin(currentAgent, event);
			const instance = conv.split(":")[1];
			const channel = options.channels.get(instance ?? "");
			const person = event.from?.startsWith("acct:") ? (await store.identity().account(event.from))?.person : undefined;
			const participation = decideParticipation(currentAgent, event, person, channel, options.hooks, {
				sourceBinding: match,
			});
			const outsideScope = currentAgent.social?.scope?.includes(conv) === false;
			let consumer: NonNullable<SessionOperabilityFact["prediction"]>["consumer"] = {
				state: "not-applicable",
				...(outsideScope ? { reason: "outside-social-scope" } : {}),
			};
			if (participation?.reason === "batch" || options.batchRequested) {
				const result = await batchConsumerForSource(currentAgent, event, match, channel, store, plugin);
				consumer =
					"issue" in result
						? {
								state: "unavailable",
								issue: result.issue,
								profile: result.profile,
								plugin: result.plugin,
								pluginSelected: result.pluginSelected,
								matchingConsumer: result.matchingConsumer,
							}
						: {
								state: "available",
								binding: result.binding.id,
								profile: result.profile,
								plugin,
								pluginSelected: true,
								matchingConsumer: true,
								derived: result.derived,
							};
			}
			const tools = {
				offer: profile.tools?.offer ?? currentAgent.defaults?.tools?.offer ?? ["*"],
				search: profile.tools?.search ?? currentAgent.defaults?.tools?.search ?? [],
			};
			const scope = profile.channelInstances ?? currentAgent.defaults?.channelInstances;
			const messageSend =
				security.capabilities.includes("message") &&
				(tools.offer.some((pattern: string) => matchesGlob(pattern, "message_send")) ||
					tools.search.some((pattern: string) => matchesGlob(pattern, "message_send"))) &&
				typeof channel?.send === "function" &&
				(!scope || scope.includes(instance ?? ""));
			const kind = (event.data as { kind?: string }).kind;
			const socialScope = currentAgent.social?.scope;
			const conversationOverride = currentAgent.social?.conversations?.[conv];
			const socialDefaults =
				kind === "dm" || kind === "group" || kind === "channel" ? currentAgent.social?.defaults?.[kind] : undefined;
			const data = event.data as { mentioned?: unknown; social?: { mentions?: { bot?: boolean; owner?: boolean } } };
			const mentioned = participation
				? (data.social?.mentions?.bot ?? data.mentioned) === true
				: data.mentioned === true;
			const ownerMention = participation?.reason === "mention" && data.social?.mentions?.owner === true;
			const dropped = policyDrops(participation, ownerMention);
			const predictedWake = wakeFor(participation, ownerMention, match.wake, mentioned);
			prediction = {
				state: "matched",
				route: dropped ? "dropped" : "not-evaluated",
				...(dropped ? { dropReason: "no-binding" as const } : {}),
				binding: match.id,
				profile: profileId,
				...(!dropped ? { wake: predictedWake } : {}),
				participation: participation
					? {
							reason: participation.reason,
							plugin,
							revision: participation.revision,
							run: participation.run,
							...("policy" in participation ? { policy: participation.policy } : {}),
						}
					: { plugin },
				participationScope: {
					...(currentAgent.social?.enabled !== undefined ? { enabled: currentAgent.social.enabled } : {}),
					...(socialScope ? { scope: socialScope } : {}),
					includesConversation: socialScope ? socialScope.includes(conv) : true,
					...(conversationOverride ? { conversationOverride } : {}),
					...(socialDefaults ? { defaults: socialDefaults } : {}),
				},
				consumer,
				reply: match.reply ?? "auto",
				capabilities: { plugins, messageSend },
			};
		}
	}
	const runState = validRuns.length
		? validRuns.some((item) => item.path === "direct")
			? "direct"
			: "batch"
		: eventsPage.next || runEndsPage.next
			? "unknown"
			: "not-observed";
	const deliveryState = receipts.length ? "delivered" : sent.next ? "unknown" : "not-observed";
	return {
		status: "observed",
		selector: { conv, ...(selector.eventId ? { eventId: selector.eventId } : {}) },
		sample: {
			eventId: event.id,
			conv,
			...(typeof sampleData.kind === "string" ? { kind: sampleData.kind } : {}),
			...(event.from ? { from: event.from } : {}),
			...(relation ? { relation } : {}),
			...(typeof sampleData.senderIsBot === "boolean" ? { senderIsBot: sampleData.senderIsBot } : {}),
			...(typeof sampleData.mentioned === "boolean" ? { mentioned: sampleData.mentioned } : {}),
			...(typeof sampleData.social?.nativeKind === "string" ? { nativeKind: sampleData.social.nativeKind } : {}),
			...(sampleData.social?.mentions
				? {
						mentions: {
							...(typeof sampleData.social.mentions.bot === "boolean" ? { bot: sampleData.social.mentions.bot } : {}),
							...(typeof sampleData.social.mentions.owner === "boolean"
								? { owner: sampleData.social.mentions.owner }
								: {}),
							...(typeof sampleData.social.mentions.everyone === "boolean"
								? { everyone: sampleData.social.mentions.everyone }
								: {}),
						},
					}
				: {}),
		},
		history: {
			...(routeView(event, agent.id, storedSession?.profile)
				? { route: routeView(event, agent.id, storedSession?.profile)! }
				: {}),
			...(decisionData
				? {
						participation: {
							...(decisionData.policy ? { policy: decisionData.policy } : {}),
							...(decisionData.reason ? { reason: decisionData.reason } : {}),
							...(decisionData.plugin ? { plugin: decisionData.plugin } : {}),
							...(decisionData.revision ? { revision: decisionData.revision } : {}),
							...(decisionData.repair ? { repair: decisionData.repair } : {}),
							...(decisionData.consumerIssue ? { consumerIssue: decisionData.consumerIssue } : {}),
							...(decisionData.profile ? { profile: decisionData.profile } : {}),
						},
					}
				: {}),
			execution: {
				state: runState,
				...(validRuns.length
					? {
							runs: validRuns.map(({ data, path }) => ({
								...(typeof data.runId === "string" ? { runId: data.runId } : {}),
								...(typeof data.status === "string" ? { status: data.status } : {}),
								path,
							})),
						}
					: {}),
			},
			delivery: {
				state: deliveryState,
				...(receipts.length
					? {
							receipts: receipts.map((item) => ({
								eventId: item.id,
								...((item.data as { session?: string }).session
									? { session: (item.data as { session: string }).session }
									: {}),
							})),
						}
					: {}),
			},
		},
		prediction,
		management: {
			paths: ["agents.validate", "agents.update", "inspect", "agents.show"],
			authority: "existing local agent management authorization required",
		},
		...(options.configuration ? { configuration: options.configuration } : {}),
	};
}
