type ConfigState = "effective" | "pending" | "rejected" | "pending-restart" | "unknown";
type ConfigStatus = {
	home: { state: ConfigState; revision?: string; file: string };
	candidate?: { state: ConfigState; revision?: string };
	agent?: { state: ConfigState; revision?: string; file: string };
};

export async function runtimeConfigFact(
	reader: { status(agentId?: string): Promise<ConfigStatus> } | undefined,
	agentId?: string | null,
) {
	const status = (await reader?.status(agentId ?? undefined)) ?? {
		home: { state: "unknown" as const, file: "yonder.yaml" },
		...(agentId ? { agent: { state: "unknown" as const, file: "agent.yaml" } } : {}),
	};
	return {
		key: "runtime-config-acceptance",
		text: `Runtime config acceptance facts (host-observed): ${JSON.stringify(status)}. These states describe currently published configuration; an open run keeps its original profile snapshot. Pending or rejected inputs are not published. pending-restart requires restarting the host.`,
	};
}

import { createHash } from "node:crypto";
import type { ContextContribution } from "@yonder/sdk";
import { systemPromptKeys, systemPromptParts } from "../prompt/index.js";
import type { PromptPart } from "../runtime/types.js";

export const sourceRevision = (text: string) => createHash("sha256").update(text).digest("hex");

export function configRuntimeSections(
	reader: () => { status(agentId?: string): Promise<ConfigStatus> } | undefined,
	options: Parameters<typeof systemPromptParts>[1],
	contexts: ReadonlyMap<string, ContextContribution>,
) {
	return {
		sections: async (session: Parameters<typeof systemPromptParts>[0], signal?: AbortSignal): Promise<PromptPart[]> => [
			...(await systemPromptParts(session, { ...options, ...(signal ? { signal } : {}) })),
			await runtimeConfigFact(reader(), session.agent),
		],
		sectionKeys: [...systemPromptKeys(contexts), "runtime-config-acceptance"],
	};
}
