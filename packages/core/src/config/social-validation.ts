import type { Channel } from "@yonder/sdk";
import type { ConfigIssue } from "./index.js";
import { hasOfficialGroupWriter } from "./official-group.js";
import type { AgentConfig, Binding, YonderConfig } from "./schema.js";

/** Reject shapes the routing admission can never execute, before publishing them. */
export function socialBindingIssues(agent: AgentConfig, file: string): ConfigIssue[] {
	return agent.bindings.flatMap((binding, index) => {
		const plugin = binding.match.type?.endsWith(".batch-ready")
			? binding.match.type.slice(0, -".batch-ready".length)
			: undefined;
		const legacyGroupBatch = binding.match.type === "channel-qq.group-batch";
		const profile = agent.profiles[binding.profile ?? agent.defaultProfile];
		const selected = profile?.plugins ?? agent.defaults?.plugins ?? [];
		const configuredPlugin = [
			...Object.values(agent.social?.defaults ?? {}),
			...Object.values(agent.social?.conversations ?? {}),
		].some((policy) => policy.plugin === plugin);
		const batch =
			legacyGroupBatch ||
			plugin === "social" ||
			(plugin !== undefined && configuredPlugin && selected.includes(plugin));
		const kinds = [binding.match.kind].flat();
		const scoped =
			!agent.social?.scope ||
			!binding.match.conv ||
			[binding.match.conv].flat().some((conv) => agent.social?.scope?.includes(conv));
		let message: string | undefined;
		if (
			batch &&
			(typeof binding.session !== "object" ||
				binding.session.per !== "conv" ||
				binding.reply !== "none" ||
				(!legacyGroupBatch && binding.wake === "write"))
		)
			message = legacyGroupBatch
				? "旧 QQ 群批次必须使用 persistent/per: conv 与 reply: none；不能进入私人 main。修正此 binding 后，运行 yonder agents validate 再 update，并用 agents show 读回"
				: "参与批次必须使用 persistent/per: conv、reply: none 和 wake: run/mention；不能进入私人 main。按这三项修正此 binding 后，运行 yonder agents validate 再 update，并用 agents show 读回";
		else if (
			binding.session === "main" &&
			agent.social?.enabled &&
			scoped &&
			(kinds.includes("group") || kinds.includes("channel"))
		)
			message =
				"social 群/频道不能进入私人 main；改用独立 persistent/per: conv 会话，并在需要主人权限时沿 parent_ask 交办。运行 yonder agents validate 再 update，并用 agents show 读回";
		return message ? [{ file, path: `/bindings/${index}`, message: `${binding.id}: ${message}` }] : [];
	});
}

export function participationBatchKinds(agent: AgentConfig, binding: Binding): string[] | undefined {
	const event = binding.match.type;
	if (!event?.endsWith(".batch-ready")) return;
	const plugin = event.slice(0, -".batch-ready".length);
	if (plugin === "social") return ["group", "channel"];
	const selected = agent.profiles[binding.profile ?? agent.defaultProfile]?.plugins ?? agent.defaults?.plugins ?? [];
	if (!selected.includes(plugin)) return;
	const kinds = Object.entries(agent.social?.defaults ?? {})
		.filter(([, policy]) => (policy.plugin ?? "social") === plugin)
		.map(([kind]) => kind);
	return kinds.length ? kinds : undefined;
}

const values = (value: string | string[] | undefined) => (value === undefined ? undefined : [value].flat());
const convChannel = (conv: string) => (conv.startsWith("conv:") ? conv.split(":", 3)[1] : undefined);

function exactGroupBatchErrors(agent: AgentConfig, channels?: ReadonlyMap<string, Channel>) {
	const social = agent.social;
	if (!social || social.enabled === false) return [];
	const errors: string[] = [];
	for (const source of agent.bindings) {
		const match = source.match;
		const convs = values(match.conv);
		if (
			!convs?.length ||
			(match.type !== undefined && match.type !== "message.in") ||
			!values(match.kind)?.includes("group")
		)
			continue;
		const profileName = source.profile ?? agent.defaultProfile;
		const profile = agent.profiles[profileName];
		for (const conv of convs) {
			const instance = convChannel(conv);
			const scoped = !social.scope || social.scope.includes(conv);
			const pluginOverride = social.conversations?.[conv];
			const policy = { ...social.defaults?.group, ...pluginOverride };
			const batch = { ...social.defaults?.group?.batch, ...pluginOverride?.batch };
			const mode = policy.mode ?? "batch";
			const officialGroup =
				!!instance &&
				hasOfficialGroupWriter({ ...agent, bindings: [source] }, instance, channels?.get(instance)) &&
				(policy.plugin ?? "social") === "social";
			const derived = !scoped && officialGroup;
			if ((!scoped && !derived) || mode !== "batch" || (batch.run !== true && !policy.judge)) continue;
			const plugin = policy.plugin ?? "social";
			const selected = profile?.plugins ?? agent.defaults?.plugins ?? [];
			const scope = profile?.channelInstances ?? agent.defaults?.channelInstances;
			const sameChannel = (binding: Binding) =>
				(!values(binding.match.conv) || values(binding.match.conv)?.includes(conv)) &&
				(!values(binding.match.channel) || values(binding.match.channel)?.includes(instance ?? "")) &&
				!binding.match.kind &&
				!binding.match.from;
			const matchingBatchBinding = (binding: Binding) => {
				const type = binding.match.type;
				const typeMatches = type === `${plugin}.batch-ready` || type === `${plugin}.*`;
				return typeMatches && sameChannel(binding);
			};
			const consumerShape = (binding: Binding) => {
				const consumerProfile = binding.profile ?? agent.defaultProfile;
				return (
					consumerProfile === profileName &&
					typeof binding.session === "object" &&
					binding.session.mode === "persistent" &&
					binding.session.per === "conv" &&
					binding.reply === "none" &&
					(binding.wake === undefined || binding.wake === "run") &&
					(!scope || scope.includes(instance ?? ""))
				);
			};
			const firstConsumer = agent.bindings.find(matchingBatchBinding);
			const matchingConsumer = !!firstConsumer && consumerShape(firstConsumer);
			const consumer =
				matchingConsumer &&
				(
					agent.profiles[firstConsumer.profile ?? agent.defaultProfile]?.plugins ??
					agent.defaults?.plugins ??
					[]
				).includes(plugin);
			const derivedEligible =
				officialGroup &&
				typeof source.session === "object" &&
				source.session.mode === "persistent" &&
				source.session.per === "conv" &&
				source.reply === "none" &&
				source.wake === "write" &&
				(!scope || scope.includes(instance ?? "")) &&
				!!channels?.get(instance ?? "");
			if (consumer || (derivedEligible && selected.includes(plugin))) continue;
			const cause = [
				...(!selected.includes(plugin) ? [`source profile ${profileName} must select ${plugin}`] : []),
				...(matchingConsumer || derivedEligible
					? []
					: [`no matching ${plugin}.batch-ready consumer for ${conv} and profile ${profileName}`]),
			].join("; ");
			errors.push(
				`${agent.id}/bindings/${source.id}: ${cause}; use a matching persistent/per:conv, wake:run, reply:none consumer or a source eligible for the existing mechanical companion, then run yonder agents validate ${agent.id} --file <candidate.json> and inspect this conversation with yonder inspect --agent ${agent.id} --conv ${conv}`,
			);
			break;
		}
	}
	return errors;
}

export function socialBatchConsumerErrors(
	agents: Iterable<AgentConfig>,
	channels?: ReadonlyMap<string, Channel>,
): string[] {
	return [...agents].flatMap((agent) => exactGroupBatchErrors(agent, channels));
}

/** Cross-file validation runs on the candidate before it is published. */
export function socialReferenceErrors(
	config: YonderConfig,
	agents: Map<string, AgentConfig>,
	loaded?: ReadonlySet<string>,
	channels?: ReadonlyMap<string, Channel>,
	options: { strictBatchConsumers?: boolean } = {},
): string[] {
	const errors: string[] = [];
	for (const agent of agents.values()) {
		for (const binding of agent.bindings) {
			if (binding.session !== "main" || ![binding.match.kind].flat().includes("group")) continue;
			const instances = binding.match.channel ? [binding.match.channel].flat() : [...(channels?.keys() ?? [])];
			if (
				instances.some(
					(id) => channels?.get(id)?.multiAgent && channels.get(id)?.features?.groupParticipation === "membership",
				)
			)
				errors.push(`${agent.id}/${binding.id}: membership group cannot enter private main; use persistent/per: conv`);
		}
		const social = agent.social;
		if (!social) continue;
		if (options.strictBatchConsumers !== false) errors.push(...exactGroupBatchErrors(agent, channels));
		if (social.enabled)
			for (const binding of agent.bindings) {
				if (binding.match.type !== "social.batch-ready") continue;
				const profile = binding.profile ?? agent.defaultProfile;
				if (!(agent.profiles[profile]?.plugins ?? agent.defaults?.plugins ?? []).includes("social"))
					errors.push(
						`${agent.id}/${binding.id}: participation plugin social is not selected by batch profile ${profile}; add social to that profile's plugins (or inherited defaults.plugins), then run yonder agents validate/update and inspect the profile`,
					);
				if (loaded && !loaded.has("social"))
					errors.push(
						`${agent.id}/${binding.id}: participation plugin social is not loaded; check yonder plugins list and the active home's plugins, load its actual package/source and restart, then run yonder agents validate`,
					);
			}
		for (const [scope, policy] of [
			...Object.entries(social.defaults ?? {}),
			...Object.entries(social.conversations ?? {}),
		]) {
			if (!policy.plugin) continue;
			const plugin = policy.plugin;
			if (loaded && !loaded.has(plugin))
				errors.push(
					`${agent.id}/social/${scope}: participation plugin ${plugin} is not loaded; check yonder plugins list and the active home's plugins, load its actual package/source and restart, then run yonder agents validate`,
				);
			const bindings = agent.bindings.filter(
				(binding) =>
					binding.match.type === `${plugin}.batch-ready` &&
					(!scope.startsWith("conv:") || !binding.match.conv || [binding.match.conv].flat().includes(scope)),
			);
			if (
				!bindings.some((binding) =>
					(agent.profiles[binding.profile ?? agent.defaultProfile]?.plugins ?? agent.defaults?.plugins ?? []).includes(
						plugin,
					),
				)
			)
				errors.push(
					`${agent.id}/social/${scope}: no matching ${plugin}.batch-ready binding uses a profile that selects ${plugin}; add the loaded plugin to that profile's plugins and a matching persistent/per: conv, reply: none batch binding, then run yonder agents validate ${agent.id} --file <candidate.json> and inspect the target conversation with yonder inspect --agent ${agent.id} --conv <conversation>`,
				);
		}
		const target = config.notifications?.outbound?.target;
		if (social.enabled && target && target.via !== "console") {
			const profile = agent.profiles[agent.defaultProfile];
			if (
				(agent.defaults?.channelInstances && !agent.defaults.channelInstances.includes(target.via)) ||
				(profile?.channelInstances && !profile.channelInstances.includes(target.via))
			)
				errors.push(`${agent.id}/social: outbound target channel outside scope ${target.via}`);
		}
		const refs = [
			...(social.scope ?? []),
			...(social.authorized?.people ?? []),
			...(social.authorized?.accounts ?? []),
			...(social.authorized?.conversations ?? []),
			...(social.friends ?? []),
			...(social.denied ?? []),
			...Object.keys(social.conversations ?? {}),
			...(social.mappings ?? []).map((mapping) => mapping.subject),
		];
		for (const ref of refs) {
			const [kind, instance = ""] = ref.split(":");
			if (kind === "person") continue;
			if (instance !== "console" && !config.channels?.[instance])
				errors.push(`${agent.id}/social: unknown channel ${instance}`);
			else if (
				instance !== "console" &&
				agent.defaults?.channelInstances &&
				!agent.defaults.channelInstances.includes(instance)
			)
				errors.push(`${agent.id}/social: channel outside scope ${instance}`);
		}
		for (const [index, mapping] of (social.mappings ?? []).entries()) {
			const target = agents.get(mapping.agent);
			if (!target) errors.push(`${agent.id}/social/mappings/${index}/agent: unknown agent ${mapping.agent}`);
			else if (!target.profiles[mapping.profile])
				errors.push(`${agent.id}/social/mappings/${index}/profile: unknown profile ${mapping.profile}`);
			else {
				const instance = mapping.subject.split(":")[1];
				const scope = target.profiles[mapping.profile]?.channelInstances ?? target.defaults?.channelInstances;
				if (mapping.subject.startsWith("acct:") || mapping.subject.startsWith("conv:"))
					if (instance !== "console" && scope && instance && !scope.includes(instance))
						errors.push(`${agent.id}/social/mappings/${index}/subject: channel outside target scope`);
			}
		}
	}
	return errors;
}
