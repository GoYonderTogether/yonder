import type { Channel, Profile, YEvent } from "@yonder/sdk";
import type { AgentConfig, Binding } from "../config/index.js";
import type { Store } from "../store/index.js";
import { channelOf, matches } from "./matching.js";

/** Deprecated QQ chain (spec 20 §3); readable, but it never defines the default participation range. */
export const legacyGroupBatch = "channel-qq.group-batch";
const list = (value: string | string[] | undefined) =>
	value === undefined ? [] : Array.isArray(value) ? value : [value];

/**
 * The spec's official group binding, recognized by shape only: `kind: group`, `wake: write`,
 * `persistent/per: conv`, `reply: none` on this event's channel instance. Message text, names and
 * group titles never participate.
 */
export function officialGroupBinding(agent: AgentConfig, event: YEvent, channel?: Channel): boolean {
	const instance = channelOf(event.conv);
	if (!instance || event.type !== "message.in" || (event.data as { kind?: unknown }).kind !== "group") return false;
	if (channel?.kinds && !channel.kinds.includes("group")) return false;
	return agent.bindings.some(
		(binding) =>
			binding.wake === "write" &&
			binding.reply === "none" &&
			typeof binding.session === "object" &&
			binding.session.mode === "persistent" &&
			binding.session.per === "conv" &&
			(binding.match.type === undefined || binding.match.type === "message.in") &&
			list(binding.match.channel).includes(instance) &&
			list(binding.match.kind).includes("group"),
	);
}

/** An un-migrated home still owns its groups through the deprecated run binding (spec 11, spec 20). */
export function legacyGroupChain(agent: AgentConfig, event: YEvent): boolean {
	const instance = channelOf(event.conv);
	return agent.bindings.some(
		(binding) => binding.match.type === legacyGroupBatch && list(binding.match.channel).includes(instance ?? ""),
	);
}

/**
 * Restricted default range for a QQ group accepted by the official group binding (08). It never
 * overrides an explicit disable, and it never applies while the deprecated chain still owns the group.
 */
export function officialGroupDefault(agent: AgentConfig, event: YEvent, channel?: Channel): boolean {
	return (
		agent.social?.enabled !== false && officialGroupBinding(agent, event, channel) && !legacyGroupChain(agent, event)
	);
}

/** A binding that can accept this participation plugin's `batch-ready` event on the instance. */
export function batchReadyBinding(agent: AgentConfig, instance: string | undefined, plugin: string): boolean {
	return agent.bindings.some(
		(binding) =>
			binding.match.type === `${plugin}.batch-ready` &&
			(list(binding.match.channel).length === 0 || list(binding.match.channel).includes(instance ?? "")),
	);
}

/** Membership is asserted by the trusted platform transport, never by message text. */
export function membershipGroup(agent: AgentConfig, event: YEvent, channel?: Channel): boolean {
	const data = event.data as { kind?: unknown; target?: unknown };
	return (
		event.type === "message.in" &&
		!!event.conv &&
		channel?.multiAgent === true &&
		channel.features?.groupParticipation === "membership" &&
		data.kind === "group" &&
		data.target === agent.id
	);
}

/** Effective defaults are visible in routes; no persistent configuration is rewritten. */
export function platformGroupBinding(agent: AgentConfig, channel: Channel): Binding {
	const profile = `@platform-group:${channel.id}`;
	agent.profiles[profile] ??= platformGroupProfile(
		agent.profiles[agent.defaultProfile] ?? agent.defaults ?? {},
		channel.id,
	);
	const id = `@platform-group:${channel.id}`;
	let binding = agent.bindings.find((b) => b.id === id);
	if (!binding) {
		binding = {
			id,
			match: { channel: channel.id, kind: "group" },
			session: { mode: "persistent", per: "conv" },
			profile,
			wake: "mention",
			reply: "none",
			busy: "steer",
		};
		agent.bindings.push(binding);
	}
	return binding;
}

export function platformGroupProfile(defaults: Profile, instance: string): Profile {
	return {
		...(defaults?.model ? { model: defaults.model } : {}),
		...(defaults?.credentialSlots ? { credentialSlots: defaults.credentialSlots } : {}),
		...(defaults?.cheap ? { cheap: defaults.cheap } : {}),
		...(defaults?.simple ? { simple: defaults.simple } : {}),
		capabilities: ["read"],
		plugins: ["social"],
		skills: [],
		contexts: ["peer-workspace"],
		tools: {
			offer: [
				"read",
				"grep",
				"conversation_read",
				"conversation_members",
				"conversation_attachment_read",
				"message_send",
				"parent_ask",
			],
			search: [],
		},
		instructions:
			"Participate as this Agent in the current group. Read the public conversation and join when relevant; otherwise stay silent. Public speech requires message_send to the current group. Keep private information private. Group membership does not grant owner or host authority.",
		channelInstances: [instance],
	};
}

export async function platformBatchBinding(
	agent: AgentConfig,
	source: YEvent,
	channel: Channel | undefined,
	store: Store,
	plugin: string,
) {
	if (!membershipGroup(agent, source, channel)) return;
	for (const candidate of agent.bindings) {
		if (!(await matches(candidate, source, agent, store))) continue;
		if (
			candidate.session === "main" ||
			candidate.session === "ephemeral" ||
			candidate.session.per !== "conv" ||
			candidate.reply !== "none" ||
			candidate.wake === "write"
		)
			return;
		return {
			...candidate,
			id: `${candidate.id}:batch`,
			match: { type: `${plugin}.batch-ready`, channel: channel!.id, conv: source.conv! },
			wake: "run" as const,
		};
	}
}

/**
 * 只有真有旧运行绑定时才算「仍在用旧链」：新配置产生的探测事件不报弃用。
 * 每个 conv 只报一次，避免重复刷日志（spec 20 §3：弃用要有运行时 warn，不当作异常）。
 */
export function warnLegacy(
	event: YEvent,
	agents: Map<string, AgentConfig>,
	warned: Set<string>,
	warn?: (message: string, data?: object) => void,
) {
	if (event.type !== legacyGroupBatch || !event.conv || warned.has(event.conv)) return;
	if (![...agents.values()].some((agent) => legacyGroupChain(agent, event))) return;
	warned.add(event.conv);
	warn?.(
		"QQ 群仍在用已弃用的 channel-qq.group-batch 运行绑定；请迁移到 social.batch-ready（yonder-qq upgrade-groups）",
		{
			conv: event.conv,
			deprecated: legacyGroupBatch,
			replacement: "social.batch-ready",
			removeIn: "0.5",
		},
	);
}

/**
 * 派生默认范围的诊断：记录事实并给出可读原因（08、11）。没有可用批次绑定时只记录观察游标，
 * 不当成可运行批次，也不转交旧链；每个 Bot/conv 只说明一次。
 */
export function defaultRangeDiagnostic(
	api: {
		warned: Set<string>;
		warn?: (message: string, data?: object) => void;
	},
	options: { agent: string; conv: string | undefined; missingBatch: boolean },
) {
	if (!options.missingBatch || !options.conv) return;
	const key = `${options.agent}\0${options.conv}`;
	if (api.warned.has(key)) return;
	api.warned.add(key);
	api.warn?.("QQ 官方群已派生默认参与范围，但没有 social.batch-ready 绑定，只能记录观察游标", {
		agent: options.agent,
		conv: options.conv,
		missing: "social.batch-ready",
	});
}

/**
 * 参与候选：显式 `social` 范围优先；scope 外/未写 scope 的官方群按受限默认参与（08），
 * 但没有 social 插件在运行时不派生——只记录观察游标，绝不转交旧链。
 */
export function participationCandidates(
	agents: Iterable<AgentConfig>,
	options: {
		event: YEvent;
		channel: Channel | undefined;
		instance: string | undefined;
		internalTarget: string | undefined;
		socialLoaded: boolean;
		derived: Set<string>;
	},
) {
	const candidates: AgentConfig[] = [];
	const { event, channel, instance, internalTarget } = options;
	if (event.type !== "message.in" || internalTarget || instance === "agent") return candidates;
	for (const agent of agents) {
		const scope = agent.profiles[agent.defaultProfile]?.channelInstances ?? agent.defaults?.channelInstances;
		if (!(instance === "console" || !scope || (!!instance && scope.includes(instance)))) continue;
		if (agent.social?.enabled && (!agent.social.scope || (!!event.conv && agent.social.scope.includes(event.conv)))) {
			candidates.push(agent);
			continue;
		}
		if (!options.socialLoaded || !officialGroupDefault(agent, event, channel)) continue;
		options.derived.add(agent.id);
		candidates.push(agent);
	}
	return candidates;
}
