import type { AgentConfig, YonderConfig } from "./schema.js";

/** Cross-file validation runs on the candidate before it is published. */
export function socialReferenceErrors(
	config: YonderConfig,
	agents: Map<string, AgentConfig>,
	loaded?: ReadonlySet<string>,
): string[] {
	const errors: string[] = [];
	for (const agent of agents.values()) {
		const social = agent.social;
		if (!social) continue;
		for (const [scope, policy] of [
			...Object.entries(social.defaults ?? {}),
			...Object.entries(social.conversations ?? {}),
		]) {
			if (!policy.plugin) continue;
			const plugin = policy.plugin;
			if (loaded && !loaded.has(plugin))
				errors.push(`${agent.id}/social/${scope}: participation plugin not loaded ${plugin}`);
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
					`${agent.id}/social/${scope}: participation plugin must be selected by a matching batch profile ${plugin}`,
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
