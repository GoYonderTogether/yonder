import type { Channel } from "@yonder/sdk";
import type { AgentConfig } from "../config/index.js";
import type { Store } from "../store/index.js";
import { batchConsumerForSource } from "./batch-consumer.js";
import { channelOf } from "./matching.js";
import { membershipGroup, officialGroupDefault } from "./platform-group.js";
import { decideParticipation, hasParticipation, type ParticipationHooks } from "./social.js";

export async function admitBatch(
	request: { agent: string; conv: string; through: string; sourceEvents: string[]; policyRevision: string },
	{
		agents,
		store,
		channels,
		plugins,
		participationHooks,
	}: {
		agents: Map<string, AgentConfig>;
		store: Store;
		channels?: Map<string, Channel>;
		plugins: ReadonlySet<string>;
		participationHooks?: ParticipationHooks;
	},
	plugin = "social",
) {
	const agent = agents.get(request.agent);
	const ids = request.sourceEvents;
	if (
		!agent ||
		agent.social?.enabled === false ||
		agent.archivedAt ||
		!plugin ||
		!plugins.has(plugin) ||
		!ids.length ||
		ids.length > 100 ||
		ids.at(-1) !== request.through ||
		ids.some((id, i) => typeof id !== "string" || (i > 0 && ids[i - 1]! >= id))
	)
		return;
	const sources = await Promise.all(ids.map((id) => store.events.get(id)));
	const source = sources.at(-1);
	const route = source?.routes?.find((item) => item.agent === agent.id && item.wake === "write" && !item.dropped);
	const sourceBinding = route?.binding ? agent.bindings.find((binding) => binding.id === route.binding) : undefined;
	if (!sourceBinding) return;
	if (
		!agent.social?.enabled &&
		(!source ||
			!(
				membershipGroup(agent, source, channels?.get(channelOf(source.conv) ?? "")) ||
				officialGroupDefault(agent, source, channels?.get(channelOf(source.conv) ?? ""), sourceBinding)
			))
	)
		return;
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
		// 只有实际被选中、且真的提供参与判定的插件才能放行批次（04 §3.6，失败关闭）。
		if (!hasParticipation(agent, item, plugin, participationHooks)) return;
		const decision = decideParticipation(
			agent,
			item,
			person,
			channels?.get(channelOf(item.conv) ?? ""),
			participationHooks,
			{ sourceBinding },
		);
		// 批次既接纳自主批次，也接纳硬触发（08：@/引用/名字/关注）在 write 绑定下的直接机会。
		if (!decision || !(decision.reason === "batch" || decision.run === true)) return;
		if (decision.revision !== request.policyRevision) return;
	}
	const consumer = await batchConsumerForSource(
		agent,
		source!,
		sourceBinding,
		channels?.get(channelOf(source!.conv) ?? ""),
		store,
		plugin,
	);
	if ("issue" in consumer) return;
	const saved = await store.sessions.get(route.session);
	if (
		!saved ||
		saved.closed ||
		saved.agent !== agent.id ||
		saved.profile !== consumer.profile ||
		saved.mode !== consumer.session.mode ||
		saved.key !== consumer.session.key
	)
		return;
	return { session: route.session };
}
