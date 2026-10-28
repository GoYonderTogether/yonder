import type { Channel } from "@yonder/sdk";
import type { AgentConfig, Binding } from "../config/index.js";
import type { Store } from "../store/index.js";
import { channelOf, matches, sessionKey } from "./matching.js";
import { socialDecision } from "./social.js";

export async function admitBatch(
	request: { agent: string; conv: string; through: string; sourceEvents: string[]; policyRevision: string },
	{ agents, store, channels }: { agents: Map<string, AgentConfig>; store: Store; channels?: Map<string, Channel> },
) {
	const agent = agents.get(request.agent);
	const ids = request.sourceEvents;
	if (
		!agent?.social?.enabled ||
		agent.archivedAt ||
		!ids.length ||
		ids.length > 100 ||
		ids.at(-1) !== request.through ||
		ids.some((id, i) => typeof id !== "string" || (i > 0 && ids[i - 1]! >= id))
	)
		return;
	const sources = await Promise.all(ids.map((id) => store.events.get(id)));
	const source = sources.at(-1);
	const route = source?.routes?.find((item) => item.agent === agent.id && item.wake === "write" && !item.dropped);
	if (
		!route?.session ||
		sources.some(
			(item) =>
				item?.type !== "message.in" ||
				item.conv !== request.conv ||
				!item.routes?.some(
					(r) => r.agent === agent.id && r.session === route.session && r.wake === "write" && !r.dropped,
				),
		)
	)
		return;
	for (const item of sources) {
		if (!item) return;
		const person = item.from?.startsWith("acct:") ? (await store.identity().account(item.from))?.person : undefined;
		const decision = socialDecision(agent, item, person, channels?.get(channelOf(item.conv) ?? ""));
		if (decision?.reason !== "batch" || decision.revision !== request.policyRevision) return;
	}
	const probe = { ...source!, type: "social.batch-ready", from: "plugin:social" };
	let binding: Binding | undefined;
	for (const candidate of agent.bindings)
		if (await matches(candidate, probe, agent, store)) {
			binding = candidate;
			break;
		}
	if (
		!binding ||
		binding.match.type !== "social.batch-ready" ||
		binding.reply !== "none" ||
		binding.wake === "write" ||
		binding.session === "main" ||
		binding.session === "ephemeral" ||
		binding.session.per !== "conv"
	)
		return;
	const saved = await store.sessions.get(route.session);
	const target = sessionKey(binding, probe);
	const scope =
		agent.profiles[binding.profile ?? agent.defaultProfile]?.channelInstances ?? agent.defaults?.channelInstances;
	if (
		!saved ||
		saved.closed ||
		saved.agent !== agent.id ||
		saved.profile !== (binding.profile ?? agent.defaultProfile) ||
		saved.mode !== target.mode ||
		saved.key !== target.key ||
		(scope && !scope.includes(channelOf(request.conv) ?? ""))
	)
		return;
	return { session: route.session };
}
