import type { Channel } from "@yonder/sdk";
import type { AgentConfig } from "./index.js";

const list = (value: string | string[] | undefined) =>
	value === undefined ? [] : Array.isArray(value) ? value : [value];

/** Shared proof that this channel has an official write-only group source binding. */
export function hasOfficialGroupWriter(agent: AgentConfig, instance: string, channel?: Channel): boolean {
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
