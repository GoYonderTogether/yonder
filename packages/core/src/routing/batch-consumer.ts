import type { Channel, YEvent } from "@yonder/sdk";
import type { AgentConfig, Binding } from "../config/index.js";
import type { Store } from "../store/index.js";
import { channelOf, matches, sessionKey } from "./matching.js";
import { platformBatchBinding } from "./platform-group.js";

export type BatchConsumerResult =
	| { binding: Binding; profile: string; session: { mode: "persistent"; key: string }; derived: boolean }
	| {
			issue: "batch-consumer-unavailable";
			profile: string;
			plugin: string;
			pluginSelected: boolean;
			matchingConsumer: boolean;
	  };

export type SocialDecisionDiagnostic = {
	agent: string;
	reason: string;
	revision: string;
	policy?: object;
	plugin?: string;
	membership?: boolean;
	derivedDefault?: boolean;
	batchBinding?: "missing";
	consumerIssue?: string;
	profile?: string;
	repair?: string;
};

export function reportMissingBatchConsumer(
	diagnostics: SocialDecisionDiagnostic[],
	agent: string,
	conv: string | undefined,
	consumer: Extract<BatchConsumerResult, { issue: string }>,
	warn?: (message: string, data: Record<string, unknown>) => void,
) {
	const diagnostic = [...diagnostics].reverse().find((item) => item.agent === agent);
	if (diagnostic)
		Object.assign(diagnostic, {
			batchBinding: "missing",
			consumerIssue: consumer.issue,
			profile: consumer.profile,
			repair: [
				...(consumer.pluginSelected ? [] : [`select ${consumer.plugin} in profile ${consumer.profile}`]),
				...(consumer.matchingConsumer
					? []
					: [
							`add a matching persistent per-conversation ${consumer.plugin}.batch-ready binding with wake:run and reply:none`,
						]),
			].join(" and "),
		});
	warn?.("参与策略的批次没有可消费的运行链；本次只记录，不创建会话", {
		diagnostic: "batch-consumer-missing",
		agent,
		conv,
		profile: consumer.profile,
		plugin: consumer.plugin,
		issue: consumer.issue,
	});
}

/** Resolve the exact batch consumer used by routing and admission. */
export async function batchConsumerForSource(
	agent: AgentConfig,
	source: YEvent,
	sourceBinding: Binding,
	channel: Channel | undefined,
	store: Store,
	plugin: string,
): Promise<BatchConsumerResult> {
	const profile = sourceBinding.profile ?? agent.defaultProfile;
	const sourceProfile = agent.profiles[profile];
	const selected = sourceProfile?.plugins ?? agent.defaults?.plugins ?? [];
	const pluginSelected = selected.includes(plugin);
	if (
		typeof sourceBinding.session !== "object" ||
		sourceBinding.session.mode !== "persistent" ||
		sourceBinding.session.per !== "conv" ||
		!source.conv
	)
		return { issue: "batch-consumer-unavailable", profile, plugin, pluginSelected, matchingConsumer: false };
	const target = { mode: "persistent" as const, key: sessionKey(sourceBinding, source).key };
	const probe: YEvent = {
		...source,
		type: `${plugin}.batch-ready`,
		from: `plugin:${plugin}`,
		data: {},
	};
	const usable = (binding: Binding) => {
		if (
			binding.reply !== "none" ||
			(binding.wake !== undefined && binding.wake !== "run") ||
			typeof binding.session !== "object" ||
			binding.session.mode !== "persistent" ||
			binding.session.per !== "conv"
		)
			return false;
		const consumerProfile = binding.profile ?? agent.defaultProfile;
		if (consumerProfile !== profile) return false;
		const resolved = agent.profiles[consumerProfile];
		const scope = resolved?.channelInstances ?? agent.defaults?.channelInstances;
		if (scope && !scope.includes(channelOf(source.conv) ?? "")) return false;
		const key = sessionKey(binding, probe);
		return key.mode === target.mode && key.key === target.key;
	};
	for (const binding of agent.bindings) {
		if (!(await matches(binding, probe, agent, store))) continue;
		const matchingConsumer = usable(binding);
		if (!matchingConsumer)
			return { issue: "batch-consumer-unavailable", profile, plugin, pluginSelected, matchingConsumer: false };
		if (
			!(agent.profiles[binding.profile ?? agent.defaultProfile]?.plugins ?? agent.defaults?.plugins ?? []).includes(
				plugin,
			)
		)
			return { issue: "batch-consumer-unavailable", profile, plugin, pluginSelected, matchingConsumer: true };
		return { binding, profile, session: target, derived: false };
	}
	if (pluginSelected) {
		const generated = await platformBatchBinding(agent, source, channel, store, plugin);
		if (generated && usable(generated)) return { binding: generated, profile, session: target, derived: true };
	}
	return { issue: "batch-consumer-unavailable", profile, plugin, pluginSelected, matchingConsumer: false };
}

export async function requireBatchSourceBinding(
	agent: AgentConfig,
	source: YEvent,
	sourceBinding: Binding | undefined,
	channel: Channel | undefined,
	store: Store,
	plugin: string,
	diagnostics: SocialDecisionDiagnostic[],
	warn?: (message: string, data: Record<string, unknown>) => void,
) {
	const consumer = sourceBinding
		? await batchConsumerForSource(agent, source, sourceBinding, channel, store, plugin)
		: {
				issue: "batch-consumer-unavailable" as const,
				profile: agent.defaultProfile,
				plugin,
				pluginSelected: false,
				matchingConsumer: false,
			};
	if ("issue" in consumer) {
		reportMissingBatchConsumer(diagnostics, agent.id, source.conv, consumer, warn);
		return undefined;
	}
	return sourceBinding;
}
