import type { Channel, YEvent } from "@yonder/sdk";
import type { AgentConfig, Binding } from "../config/index.js";
import type { Sessions } from "../sessions/index.js";
import type { Store } from "../store/index.js";
import { channelOf, matches, sessionKey } from "./matching.js";
import { participationPlugin } from "./participation.js";
import { socialDecision } from "./social.js";

export async function suppressLegacyBatch(
	agent: AgentConfig,
	event: YEvent,
	legacySource: YEvent,
	store: Store,
	sessions: Sessions,
	channels?: Map<string, Channel>,
	plugins: ReadonlySet<string> = new Set(),
): Promise<boolean> {
	const plugin = participationPlugin(agent, legacySource);
	if (!plugins.has(plugin)) return false;
	const sourceRoute = legacySource.routes?.find(
		(route) => route.agent === agent.id && route.wake === "write" && !route.dropped,
	);
	const sourcePerson = legacySource.from?.startsWith("acct:")
		? (await store.identity().account(legacySource.from))?.person
		: undefined;
	const decision = socialDecision(agent, legacySource, sourcePerson, channels?.get(channelOf(legacySource.conv) ?? ""));
	if (
		sourceRoute?.session &&
		decision?.reason === "batch" &&
		"policy" in decision &&
		(decision.policy.batch?.run !== true || decision.policy.judge)
	) {
		return true;
	}
	const probe = { ...event, type: `${plugin}.batch-ready`, from: `plugin:${plugin}` };
	let binding: Binding | undefined;
	for (const candidate of agent.bindings) {
		if (await matches(candidate, probe, agent, store)) {
			binding = candidate;
			break;
		}
	}
	if (
		sourceRoute?.session &&
		decision?.reason === "batch" &&
		binding?.match.type === `${plugin}.batch-ready` &&
		(agent.profiles[binding.profile ?? agent.defaultProfile]?.plugins ?? agent.defaults?.plugins ?? []).includes(
			plugin,
		) &&
		binding.reply === "none" &&
		binding.wake !== "write" &&
		binding.session !== "main" &&
		binding.session !== "ephemeral" &&
		binding.session.per === "conv"
	) {
		const { mode, key } = sessionKey(binding, probe, undefined);
		const target = await sessions.ensureAgent(agent.id, binding.profile ?? agent.defaultProfile, key, mode);
		if (!target.profileMismatch && target.session.id === sourceRoute.session) {
			return true;
		}
	}
	return false;
}
