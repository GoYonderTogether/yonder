import type { SocialPolicy } from "@yonder/sdk";
import type { AgentConfig } from "../config/index.js";
import type { SessionOperabilityFact } from "./operability.js";

type Route = {
	operability?: Partial<Pick<SessionOperabilityFact, "status" | "reason" | "sample" | "history" | "prediction">>;
};
type InspectRoute = (
	agent: string,
	conv: string,
	event: string | undefined,
	policy: SocialPolicy,
	candidate?: AgentConfig,
) => Promise<Route | undefined>;

/** Known blockers from the same candidate route and consumer projection used by social.inspect. */
export async function batchPreflightData(
	agentId: string,
	conv: string,
	policy: SocialPolicy,
	candidate: AgentConfig | undefined,
	inspectRoute: InspectRoute | undefined,
): Promise<{ state: "blocked"; data: Record<string, string> } | { state: "ready" | "unknown"; reason?: string }> {
	const route = await inspectRoute?.(agentId, conv, undefined, policy, candidate);
	const gaps = batchProcessingGaps(agentId, conv, policy, candidate, route);
	if (gaps.length)
		return { state: "blocked", data: { preflight: JSON.stringify({ state: "blocked", agent: agentId, conv, gaps }) } };
	const fact = route?.operability;
	if (
		fact?.status === "observed" &&
		fact.prediction?.state === "matched" &&
		fact.prediction.consumer?.state === "available"
	)
		return { state: "ready" };
	return { state: "unknown", reason: fact?.reason ?? "candidate source or batch consumer was not fully observed" };
}

function batchProcessingGaps(
	agentId: string,
	conv: string,
	policy: SocialPolicy,
	candidate: AgentConfig | undefined,
	route: Route | undefined,
) {
	const gaps: Array<Record<string, unknown>> = [];
	const fact = route?.operability;
	if (fact?.status !== "observed") return gaps;
	const prediction = fact.prediction;
	if (prediction?.state === "no-match")
		return [
			{
				dependency: "source-binding",
				object: `agent:${agentId}`,
				field: "bindings",
				repair: "agents.show/validate/update: add or correct the first matching group source binding",
			},
		];
	if (prediction?.state !== "matched") return gaps;
	const profileId = prediction.profile ?? candidate?.defaultProfile ?? "unknown";
	const plugin = prediction.consumer?.plugin ?? prediction.participation?.plugin ?? policy.plugin ?? "social";
	if (prediction.participationScope?.includesConversation === false && !prediction.participation?.reason)
		gaps.push({
			dependency: "social.scope",
			object: `agent:${agentId}`,
			field: "social.scope",
			conv,
			repair:
				"agents.update: include this exact conversation in social.scope when the source is not covered by membership or an official derived default",
		});
	const plugins = prediction.capabilities?.plugins;
	if (plugins && !plugins.includes(plugin))
		gaps.push({
			dependency: "participation-plugin",
			object: `agent:${agentId}.profiles.${profileId}`,
			field: "plugins",
			plugin,
			repair: "agents.show/validate/update: select the installed participation plugin in the source profile",
		});
	const consumer = prediction.consumer;
	if (consumer?.state === "unavailable")
		gaps.push({
			dependency: "batch-consumer",
			object: `agent:${agentId}.bindings`,
			fields: ["match", "profile", "session", "wake", "reply"],
			profile: consumer.profile ?? profileId,
			plugin: consumer.plugin ?? plugin,
			pluginSelected: consumer.pluginSelected,
			matchingConsumer: consumer.matchingConsumer,
			repair:
				"agents.show/validate/update: add an exact batch-ready binding using the source profile and persistent per-conversation session, wake:run, reply:none",
		});
	return gaps;
}
