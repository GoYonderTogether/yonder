type ConfigState = "effective" | "pending" | "rejected" | "pending-restart" | "unknown";
export type ConfigStatus = {
	home: { state: ConfigState; revision?: string; acceptedRevision?: string; file: string };
	candidate: { state: ConfigState; revision?: string; acceptedRevision?: string };
	agent?: { state: ConfigState; revision?: string; acceptedRevision?: string; file: string };
	issues?: Array<{ scope: "home" | "agent" | "candidate"; path?: string }>;
};

export async function runtimeConfigFact(
	reader: { status(agentId?: string): Promise<ConfigStatus> } | undefined,
	agentId?: string | null,
) {
	const status = (await reader?.status(agentId ?? undefined)) ?? {
		home: { state: "unknown" as const, file: "yonder.yaml" },
		candidate: { state: "unknown" as const },
		...(agentId ? { agent: { state: "unknown" as const, file: "agent.yaml" } } : {}),
	};
	return {
		key: "runtime-config-acceptance",
		text: `Runtime config acceptance facts (host-observed): ${JSON.stringify(status)}. revision is the current disk revision; acceptedRevision identifies the last accepted source when known. Disk candidate and currently accepted configuration are distinct: pending or rejected inputs are not published, and this open run keeps its original profile snapshot. Rejected issue paths are bounded and omit source text. If an issue is present, use an available authorized native management path to validate, update, then show the Agent. The CLI form, when available, is yonder agents validate <id> --file <json>, yonder agents update <id> --file <json>, then yonder agents show <id>. Treat the relevant candidate or Agent as effective only when runtime status confirms effective, or an existing authorized management acceptance receipt matches its disk revision. Pending, rejected, pending-restart, and unknown are not completion evidence. If the required tool, executable, or authority is unavailable, report that limitation. pending-restart requires restarting the host.`,
	};
}

import { createHash } from "node:crypto";
import { systemPromptKeys, systemPromptParts } from "@yonder/bot-core/prompt/index";
import type { PromptPart } from "@yonder/runtime-adapter/types";
import type { ContextContribution } from "@yonder/sdk";

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
