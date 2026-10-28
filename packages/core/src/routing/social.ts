import { createHash } from "node:crypto";
import type { Channel, SocialMessageData, YEvent } from "@yonder/sdk";
import type { AgentConfig, Binding } from "../config/index.js";

type Kind = "dm" | "group" | "channel";
export function socialDecision(agent: AgentConfig, event: YEvent, person: string | undefined, channel?: Channel) {
	const social = agent.social;
	if (!social?.enabled || event.type !== "message.in") return undefined;
	const data = event.data as { kind?: unknown; mentioned?: unknown; social?: SocialMessageData };
	const kind = data.kind;
	const revision = createHash("sha256").update(JSON.stringify(social)).digest("hex");
	const result = (reason: string, run = false) => ({ reason, run, revision });
	if (kind !== "dm" && kind !== "group" && kind !== "channel") return result("unsupported-kind");
	if (channel?.kinds && !channel.kinds.includes(kind)) return result("channel-kind-mismatch");
	const subjects = [event.conv, event.from, person].filter((v): v is string => !!v);
	if (subjects.some((s) => social.denied?.includes(s))) return result("denied");
	const owner = kind === "dm" && !!person && person === agent.owner;
	const authorized =
		owner ||
		!!(event.conv && social.authorized?.conversations?.includes(event.conv)) ||
		!!(event.from && social.authorized?.accounts?.includes(event.from)) ||
		!!(person && social.authorized?.people?.includes(person));
	if (!authorized) return result("not-authorized");
	const policy = {
		...social.defaults?.[kind as Kind],
		...(event.conv ? social.conversations?.[event.conv] : undefined),
	};
	const mode: string = policy.mode ?? (kind === "dm" ? "direct" : "batch");
	if (policy.quiet) {
		try {
			const time = new Intl.DateTimeFormat("en-GB", {
				timeZone: policy.quiet.timezone,
				hour: "2-digit",
				minute: "2-digit",
				hourCycle: "h23",
			}).format(new Date());
			const { start, end } = policy.quiet;
			if (start < end ? time >= start && time < end : time >= start || time < end) return result("quiet");
		} catch {
			return result("invalid-timezone");
		}
	}
	if (mode === "mute" || mode === "record" || mode === "folded") return result(mode);
	if (kind === "dm") return result("direct", mode === "direct");
	const nativeMention = data.social?.mentions?.bot;
	if (typeof nativeMention === "boolean" && typeof data.mentioned === "boolean" && nativeMention !== data.mentioned)
		return result("mention-conflict");
	const mention = nativeMention === true || (nativeMention === undefined && data.mentioned === true);
	if (mention && (policy.signals?.botMention ?? "respond") === "respond") return result("bot-mention", true);
	return result(mode);
}

export function socialBindingAllowed(
	agent: AgentConfig,
	event: YEvent,
	person: string | undefined,
	binding: Binding,
): boolean {
	if (!agent.social?.enabled || event.type !== "message.in") return true;
	const kind = (event.data as { kind?: unknown }).kind;
	return binding.session !== "main" || (kind === "dm" && !!person && person === agent.owner);
}
