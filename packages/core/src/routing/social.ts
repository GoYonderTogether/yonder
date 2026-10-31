import { createHash } from "node:crypto";
import type { Channel, SocialMessageData, YEvent } from "@yonder/sdk";
import type { AgentConfig, Binding } from "../config/index.js";
import { participationPlugin } from "./participation.js";
import { membershipGroup, officialGroupBinding, officialGroupDefault } from "./platform-group.js";

type Kind = "dm" | "group" | "channel";
export function socialDecision(agent: AgentConfig, event: YEvent, person: string | undefined, channel?: Channel) {
	const member = membershipGroup(agent, event, channel);
	// 官方群绑定接纳本身就授权该群（08），与是否派生默认范围无关。
	const bound = member || officialGroupBinding(agent, event, channel);
	// 08「官方 QQ 群的默认参与范围」：官方群绑定接纳的群在没有手写 scope 时派生的受限默认，不写回配置。
	// 显式选择的自定义参与插件优先：不会被派生默认为运行，也不由 social 代它判断。
	const custom = agent.social?.enabled === true && participationPlugin(agent, event) !== "social";
	const official = !member && !custom && officialGroupDefault(agent, event, channel);
	const social = agent.social ?? (member || official ? { enabled: true } : undefined);
	if (
		!social ||
		social.enabled === false ||
		(!social.enabled && !member && !official) ||
		event.type !== "message.in" ||
		(!member && !official && social.scope && (!event.conv || !social.scope.includes(event.conv)))
	)
		return undefined;
	const data = event.data as {
		kind?: unknown;
		mentioned?: unknown;
		text?: unknown;
		senderIsBot?: unknown;
		social?: SocialMessageData;
	};
	const kind = data.kind;
	const revision = createHash("sha256").update(JSON.stringify(social)).digest("hex");
	const result = (reason: string, run = false) => ({ reason, run, revision });
	if (kind !== "dm" && kind !== "group" && kind !== "channel") return result("unsupported-kind");
	if (channel?.kinds && !channel.kinds.includes(kind)) return result("channel-kind-mismatch");
	const subjects = [event.conv, event.from, person].filter((v): v is string => !!v);
	if (subjects.some((s) => social.denied?.includes(s))) return result("denied");
	const owner = kind === "dm" && !!person && person === agent.owner;
	// 官方群绑定接纳本身就是该群的授权（08），不需要再手写 authorized。
	const authorized =
		bound ||
		owner ||
		!!(event.conv && social.authorized?.conversations?.includes(event.conv)) ||
		!!(event.from && social.authorized?.accounts?.includes(event.from)) ||
		!!(person && social.authorized?.people?.includes(person));
	if (!authorized) return result("not-authorized");
	const defaults = social.defaults?.[kind as Kind];
	const override = event.conv ? social.conversations?.[event.conv] : undefined;
	const policy = {
		...defaults,
		...override,
		...(defaults?.batch || override?.batch ? { batch: { ...defaults?.batch, ...override?.batch } } : {}),
		...(defaults?.signals || override?.signals ? { signals: { ...defaults?.signals, ...override?.signals } } : {}),
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
	if (mode === "folded") return { ...result(mode), policy };
	if (mode === "mute" || mode === "record") return result(mode);
	if (kind !== "dm" && (event.data as { senderIsBot?: boolean }).senderIsBot === true) return result("record");
	if (kind === "dm") return result("direct", mode === "direct");
	const nativeMention = data.social?.mentions?.bot;
	if (
		typeof nativeMention === "boolean" &&
		typeof data.mentioned === "boolean" &&
		nativeMention !== data.mentioned &&
		!(nativeMention === false && data.mentioned && data.social?.mentions?.everyone === true)
	)
		return result("mention-conflict");
	const mention =
		nativeMention === true ||
		(nativeMention === undefined && data.mentioned === true && data.social?.mentions?.everyone !== true);
	const signals = [
		["bot-mention", mention, policy.signals?.botMention ?? "respond"],
		["owner-mention", data.social?.mentions?.owner === true, policy.signals?.ownerMention ?? "consider"],
		["group-owner", data.social?.senderRole === "group-owner", policy.signals?.groupOwner ?? "consider"],
		["everyone", data.social?.mentions?.everyone === true, policy.signals?.everyone ?? "consider"],
		[
			"keyword",
			typeof data.text === "string" &&
				policy.keywords?.some((word) => (data.text as string).normalize("NFC").includes(word.normalize("NFC"))),
			policy.signals?.keyword ?? "consider",
		],
	] as const;
	const responding = signals.find(([, matched, action]) => matched && action === "respond");
	if (responding) return { ...result(responding[0], true), policy };
	return { ...result(mode), policy };
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
