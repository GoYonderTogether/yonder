import { createHash } from "node:crypto";
import type {
	Participation,
	ParticipationDecision,
	ParticipationInput,
	ParticipationReason,
	SocialMessageData,
	SocialPolicy,
} from "@yonder/sdk";

type Kind = "dm" | "group" | "channel";

/**
 * 官方群参与策略（04 §3.6）。内核已经把平台事实与绑定事实算进 `input.facts`；这里只按该 Bot 的
 * social 配置给出判定，不读事件之外的任何状态、不做 IO、不调用模型。
 *
 * 逻辑从内核 `routing/social.ts` 原样搬来：原因、唤醒结果、policy 快照与 revision 都保持一致。
 */
export function decideParticipation(input: ParticipationInput): ParticipationDecision | undefined {
	const social = input.agent.social;
	// 内核只在实际生效时调用；没有配置就交回 undefined，由内核按不可用失败关闭。
	if (!social) return undefined;
	const data = input.event.data as {
		kind?: unknown;
		mentioned?: unknown;
		text?: unknown;
		senderIsBot?: unknown;
		social?: SocialMessageData;
	};
	const kind = data.kind;
	const revision = createHash("sha256").update(JSON.stringify(social)).digest("hex");
	const result = (reason: ParticipationReason, run = false): ParticipationDecision => ({ reason, run, revision });
	if (kind !== "dm" && kind !== "group" && kind !== "channel") return result("unsupported-kind");
	if (input.channel?.kinds && !input.channel.kinds.includes(kind)) return result("channel-kind-mismatch");
	const subjects = [input.event.conv, input.event.from, input.person].filter((value): value is string => !!value);
	if (subjects.some((subject) => social.denied?.includes(subject))) return result("denied");
	const owner = kind === "dm" && !!input.person && input.person === input.agent.owner;
	// 官方群绑定接纳本身就是该群的授权（08），不需要再手写 authorized。
	const authorized =
		input.facts.bound ||
		owner ||
		!!(input.event.conv && social.authorized?.conversations?.includes(input.event.conv)) ||
		!!(input.event.from && social.authorized?.accounts?.includes(input.event.from)) ||
		!!(input.person && social.authorized?.people?.includes(input.person));
	if (!authorized) return result("not-authorized");
	const defaults = social.defaults?.[kind as Kind];
	const override = input.event.conv ? social.conversations?.[input.event.conv] : undefined;
	const policy = {
		...defaults,
		...override,
		...(defaults?.batch || override?.batch ? { batch: { ...defaults?.batch, ...override?.batch } } : {}),
		...(defaults?.signals || override?.signals ? { signals: { ...defaults?.signals, ...override?.signals } } : {}),
	};
	const mode: Participation = policy.mode ?? (kind === "dm" ? "direct" : "batch");
	if (policy.quiet) {
		try {
			const time = new Intl.DateTimeFormat("en-GB", {
				timeZone: policy.quiet.timezone,
				hour: "2-digit",
				minute: "2-digit",
				hourCycle: "h23",
			}).format(new Date(input.now));
			const { start, end } = policy.quiet;
			if (start < end ? time >= start && time < end : time >= start || time < end) return result("quiet");
		} catch {
			return result("invalid-timezone");
		}
	}
	if (mode === "folded") return { ...result(mode), policy: policy as SocialPolicy };
	if (mode === "mute" || mode === "record") return result(mode);
	if (kind !== "dm" && data.senderIsBot === true) return result("record");
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
	if (responding) return { ...result(responding[0], true), policy: policy as SocialPolicy };
	return { ...result(mode), policy: policy as SocialPolicy };
}
