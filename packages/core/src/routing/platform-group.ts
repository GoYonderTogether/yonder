import type { Channel, Profile, YEvent } from "@yonder/sdk";
import type { AgentConfig, Binding } from "../config/index.js";
import type { Store } from "../store/index.js";
import { matches } from "./matching.js";

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
