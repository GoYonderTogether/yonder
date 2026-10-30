import type { YEvent } from "@yonder/sdk";
import type { AgentConfig } from "../config/index.js";

export const isParticipationBatch = (event: Pick<YEvent, "type">) => event.type.endsWith(".batch-ready");

/** The source identity is bound by the plugin host, never supplied by admission arguments. */
export function batchPlugin(event: Pick<YEvent, "type" | "from">): string | undefined {
	const plugin = event.from?.startsWith("plugin:") ? event.from.slice(7) : undefined;
	return plugin && event.type === `${plugin}.batch-ready` ? plugin : undefined;
}

export function participationPlugin(agent: AgentConfig, source: YEvent): string {
	const kind = (source.data as { kind?: string }).kind;
	const defaults = kind === "dm" || kind === "group" || kind === "channel" ? agent.social?.defaults?.[kind] : undefined;
	return (source.conv && agent.social?.conversations?.[source.conv]?.plugin) || defaults?.plugin || "social";
}
