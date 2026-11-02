import { createHash } from "node:crypto";
import type { Channel, Hook, ParticipationDecision, ParticipationReason, SocialConfig, YEvent } from "@yonder/sdk";
import type { AgentConfig, Binding } from "../config/index.js";
import { participationPlugin } from "./participation.js";
import { membershipGroup, officialGroupBinding, officialGroupDefault } from "./platform-group.js";

export type ParticipationHooks = ReadonlyMap<string, readonly Hook[]>;

/** Closed reason set (04 §3.6); any other value is an invalid plugin answer and fails closed. */
const reasons = new Set<string>([
	"unsupported-kind",
	"channel-kind-mismatch",
	"denied",
	"not-authorized",
	"quiet",
	"invalid-timezone",
	"mention-conflict",
	"bot-mention",
	"owner-mention",
	"group-owner",
	"everyone",
	"keyword",
	"direct",
	"record",
	"mention",
	"batch",
	"folded",
	"mute",
]);

/** The social config's content version (01 §3, same algorithm as `kernel/social.ts`). */
export const socialRevision = (social: SocialConfig) =>
	createHash("sha256").update(JSON.stringify(social)).digest("hex");

const valid = (value: unknown): value is ParticipationDecision => {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const decision = value as Record<string, unknown>;
	return (
		typeof decision.reason === "string" &&
		reasons.has(decision.reason) &&
		typeof decision.run === "boolean" &&
		typeof decision.revision === "string" &&
		(decision.policy === undefined ||
			(typeof decision.policy === "object" && decision.policy !== null && !Array.isArray(decision.policy)))
	);
};

/**
 * Kernel-side facts and gating for one inbound event (04 §3.6, 08). Nothing here is policy: membership,
 * official group acceptance, the derived default range and scope decide only whether a participation
 * policy applies at all. The decision itself belongs to the selected plugin.
 */
function applicable(agent: AgentConfig, event: YEvent, channel: Channel | undefined, sourceBinding?: Binding | null) {
	const member = membershipGroup(agent, event, channel);
	// An official group binding already authorizes its group (08), whether or not a default range is derived.
	const bound = member || officialGroupBinding(agent, event, channel, sourceBinding);
	// A custom participation plugin takes precedence: the derived default never speaks for it.
	const custom = agent.social?.enabled === true && participationPlugin(agent, event) !== "social";
	const officialDefault = !member && !custom && officialGroupDefault(agent, event, channel, sourceBinding);
	const social = agent.social ?? (member || officialDefault ? { enabled: true } : undefined);
	if (
		!social ||
		social.enabled === false ||
		(!social.enabled && !member && !officialDefault) ||
		event.type !== "message.in" ||
		(!member && !officialDefault && social.scope && (!event.conv || !social.scope.includes(event.conv)))
	)
		return undefined;
	return { member, bound, officialDefault, custom, social };
}

/**
 * The participation decision for one event (04 §3.6): the kernel resolves the selected plugin from
 * `SocialPolicy.plugin` (default `social`) and calls it synchronously, then validates the answer.
 * A missing plugin, a thrown error or a malformed answer fails closed: outbound delivery is blocked,
 * inbound only records. `onUnavailable` lets callers write the `no-participation-plugin` diagnostic.
 */
export function decideParticipation(
	agent: AgentConfig,
	event: YEvent,
	person: string | undefined,
	channel: Channel | undefined,
	hooks: ParticipationHooks | undefined,
	options: {
		outbound?: boolean;
		onUnavailable?: (plugin: string) => void;
		sourceBinding?: Binding | null;
	} = {},
): ParticipationDecision | undefined {
	const facts = applicable(agent, event, channel, options.sourceBinding);
	if (!facts) return undefined;
	const plugin = participationPlugin(agent, event);
	const hook = hooks?.get(plugin)?.find((item) => typeof item.participation === "function");
	let decision: ParticipationDecision | undefined;
	if (hook?.participation) {
		try {
			decision = hook.participation({
				agent: {
					id: agent.id,
					...(agent.owner ? { owner: agent.owner } : {}),
					social: facts.social,
				},
				event,
				...(person ? { person } : {}),
				...(channel
					? {
							channel: {
								kinds: channel.kinds,
								...(channel.features ? { features: channel.features } : {}),
							},
						}
					: {}),
				facts: {
					member: facts.member,
					bound: facts.bound,
					officialDefault: facts.officialDefault,
					custom: facts.custom,
				},
				now: new Date().toISOString(),
			});
		} catch {
			decision = undefined;
		}
	}
	if (valid(decision)) return decision;
	options.onUnavailable?.(plugin);
	if (options.outbound) throw new Error("Social delivery blocked: participation-unavailable");
	return { reason: "record" satisfies ParticipationReason, run: false, revision: socialRevision(facts.social) };
}

/**
 * Whether `plugin` really provides participation for this source event: loaded, exposes the hook, and is
 * the plugin `SocialPolicy.plugin` selects there. Only a real policy may admit a batch or suppress the
 * deprecated chain; a missing one fails closed.
 */
export function hasParticipation(
	agent: AgentConfig,
	source: Pick<YEvent, "type" | "conv" | "from" | "data">,
	plugin: string,
	hooks: ParticipationHooks | undefined,
): boolean {
	if (!hooks?.get(plugin)?.some((hook) => typeof hook.participation === "function")) return false;
	return participationPlugin(agent, source as YEvent) === plugin;
}

export function socialBindingAllowed(
	agent: AgentConfig,
	event: YEvent,
	person: string | undefined,
	binding: Binding,
): boolean {
	if (
		!agent.social?.enabled ||
		event.type !== "message.in" ||
		(agent.social.scope && (!event.conv || !agent.social.scope.includes(event.conv)))
	)
		return true;
	const kind = (event.data as { kind?: unknown }).kind;
	return binding.session !== "main" || (kind === "dm" && !!person && person === agent.owner);
}
