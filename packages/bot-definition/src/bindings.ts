import { CONSOLE } from "./console.js";
import type { AgentConfig, Binding } from "./schema.js";

// Console identity and its instance-scope predicates live in config/console.ts; the binding-shape predicates
// that depend on a full agent config live here, still at L0 (architecture §6).
export { allowsChannelInstance, assertChannelInstance, CONSOLE, CONSOLE_BINDING } from "./console.js";

/** Whether a binding targets the built-in console channel. */
const onConsole = (binding: AgentConfig["bindings"][number]): boolean =>
	[binding.match.channel].flat().includes(CONSOLE);

/** A resident Bot is an agent with a live binding into the built-in console channel. */
export const isConsoleBot = (agent: AgentConfig): boolean => !agent.archivedAt && agent.bindings.some(onConsole);

const matchesAgent = (value: string | string[] | undefined) =>
	value === undefined || (Array.isArray(value) ? value.includes("agent") : value === "agent");

/** Whether another agent's agent_ask can reach this agent through an existing binding. */
export function canReceivePeerAsk(agent: AgentConfig): boolean {
	return agent.bindings.some((b) => matchesAgent(b.match.channel) && matchesAgent(b.match.kind));
}

const list = (value: string | string[] | undefined) =>
	value === undefined ? undefined : Array.isArray(value) ? value : [value];
const conversationChannel = (conv: string) => (conv.startsWith("conv:") ? conv.split(":", 3)[1] : undefined);
const convChannelMatches = (binding: Binding, conv: string) => {
	const channels = list(binding.match.channel);
	return channels === undefined || (!!conversationChannel(conv) && channels.includes(conversationChannel(conv)!));
};
const perConversation = (binding: Binding) => typeof binding.session === "object" && binding.session.per === "conv";
const profileOf = (agent: AgentConfig, binding: Binding) => binding.profile ?? agent.defaultProfile;

/** Finite conv keys this pair may share; undefined means both selectors are unbounded. */
export function sharedConvKeys(a: Binding, b: Binding): string[] | undefined {
	const aConvs = list(a.match.conv);
	const bConvs = list(b.match.conv);
	if (aConvs === undefined && bConvs === undefined) return undefined;
	const candidates = aConvs ?? bConvs ?? [];
	return [...new Set(candidates)].filter(
		(conv) =>
			(bConvs === undefined || bConvs.includes(conv)) && convChannelMatches(a, conv) && convChannelMatches(b, conv),
	);
}

const exactConvCatchall = (binding: Binding, conv: string) =>
	perConversation(binding) &&
	list(binding.match.conv)?.includes(conv) === true &&
	binding.match.kind === undefined &&
	binding.match.from === undefined &&
	effectiveType(binding) === "message.in" &&
	convChannelMatches(binding, conv);

const effectiveType = (binding: Binding) => binding.match.type ?? "message.in";
const exactConvTypeCover = (binding: Binding, conv: string) =>
	perConversation(binding) &&
	list(binding.match.conv)?.includes(conv) === true &&
	binding.match.kind === undefined &&
	binding.match.from === undefined &&
	convChannelMatches(binding, conv);

/** Whether this finite conv key has one safe effective profile across ordinary and separately typed inputs. */
export function convProfilesConflict(agent: AgentConfig, conv: string): boolean {
	const bindings = agent.bindings.filter(
		(binding) =>
			perConversation(binding) &&
			(list(binding.match.conv) === undefined || list(binding.match.conv)!.includes(conv)) &&
			convChannelMatches(binding, conv),
	);
	const effective = bindings.filter(
		(binding, index) =>
			!bindings
				.slice(0, index)
				.some((previous) => exactConvTypeCover(previous, conv) && effectiveType(previous) === effectiveType(binding)),
	);
	const anchor = effective.findIndex((binding) => exactConvCatchall(binding, conv));
	if (anchor < 0) return new Set(effective.map((binding) => profileOf(agent, binding))).size > 1;
	const profile = profileOf(agent, effective[anchor]!);
	return effective.some((binding, index) => {
		const ordinary = binding.match.type === undefined || binding.match.type === "message.in";
		return ordinary ? index < anchor && profileOf(agent, binding) !== profile : profileOf(agent, binding) !== profile;
	});
}

/** Profile selected by a safe exact-conv catchall, used to protect already-open persistent sessions. */
export function exactConvProfile(agent: AgentConfig, conv: string): string | undefined {
	if (convProfilesConflict(agent, conv)) return undefined;
	const binding = agent.bindings.find((candidate) => exactConvCatchall(candidate, conv));
	return binding && profileOf(agent, binding);
}
