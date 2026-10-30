import type { ChannelLoginResult, RunResult, SessionInfo, YEvent } from "@yonder/sdk";
import type { YonderConfig } from "../config/index.js";
import type { DeliveryService } from "../delivery/index.js";
import { runChannelCommand } from "../routing/commands.js";
import type { Db } from "../runtime/db.js";
import type { RuntimeRun, RuntimeSessionConfig } from "../runtime/index.js";
import type { createSessions } from "../sessions/index.js";
import type { SkillsReport } from "../skills/index.js";
import type { Store } from "../store/index.js";
import { createQuota, type OutsiderSubject, type QuotaRejectionReason } from "./quota.js";

/** 主人、已绑定账号的人、未绑定账号的访客。额度与能力按这个分层决定（IMP-25）。 */
export type OutsiderTier = "owner" | "person" | "guest";

interface ChannelServices {
	store: Store;
	sessions: ReturnType<typeof createSessions>;
	delivery: DeliveryService;
	skills: (profile: RuntimeSessionConfig) => Promise<SkillsReport>;
	loginChannel?: (request: { instance?: string }, signal: AbortSignal) => Promise<ChannelLoginResult>;
	/** 现有配置重载入口；未提供时 /reload 保持“当前服务不支持重载”。 */
	reload?: () => Promise<unknown>;
}

export interface QuotaWireOptions extends ChannelServices {
	db: Db;
	config: YonderConfig;
	/** 已配置的渠道实例；其余来源不走渠道命令，也不消费额度。 */
	channels?: { has(name: string): boolean };
	now?: () => number;
}

export interface QuotaWire {
	/** 渠道命令与外人额度闸门：返回结果表示这一轮已经处理完毕，不再交给模型。 */
	command(session: SessionInfo, event: YEvent): Promise<RunResult | undefined>;
	/** 运行结束后按实际用量记账；主人与 bot 自己的会话不记账。 */
	settle(id: string, run: RuntimeRun): Promise<void>;
}

interface Resolved {
	tier: OutsiderTier;
	subject?: OutsiderSubject;
}

const closedMessage = "这个渠道没有对访客开放。绑定账号登录后可以继续使用。";

/**
 * 把每一轮的来源映射成额度层。
 * 来源身份只来自事件的 from，不来自会话行：同一个会话可能是主人接着访客在用。
 */
function resolve(store: Store, session: SessionInfo, event: YEvent): Promise<Resolved> {
	const from = event.from;
	if (!from?.startsWith("acct:") || session.owner?.kind === "bot") return Promise.resolve({ tier: "owner" });
	return store
		.identity()
		.relation(session.agent ?? "main", from)
		.then(async (relation) => {
			if (relation === "owner") return { tier: "owner" };
			const person = (await store.identity().account(from))?.person;
			if (person) return { tier: "person", subject: { kind: "person", person } };
			return { tier: "guest", subject: { kind: "guest", qr: event.conv ?? from, source: from } };
		});
}

export function quotaWire(options: QuotaWireOptions): QuotaWire {
	const { config, db, store } = options;
	const quota = createQuota({
		db,
		outsiders: config.outsiders ?? {},
		...(config.timezone ? { timezone: config.timezone } : {}),
		...(options.now ? { now: options.now } : {}),
	});

	function channelServices(): Parameters<typeof runChannelCommand>[2] {
		const { store, sessions, delivery, skills, loginChannel, reload } = options;
		return {
			store,
			sessions,
			delivery,
			skills,
			...(reload ? { reload } : {}),
			...(loginChannel
				? {
						login: (instance?: string) =>
							loginChannel(instance === undefined ? {} : { instance }, new AbortController().signal),
					}
				: {}),
		};
	}

	async function reject(
		session: SessionInfo,
		event: YEvent,
		tier: OutsiderTier,
		reason: QuotaRejectionReason | "channel_closed",
		message: string,
		remaining = 0,
	): Promise<RunResult> {
		await store.events.record({
			type: "outsider.rejected",
			parent: event.id,
			...(event.from ? { from: event.from } : {}),
			...(event.conv ? { conv: event.conv } : {}),
			data: { session: session.id, tier, reason, remaining, login: "/connect", hint: message },
		});
		if (event.conv) await options.delivery.sendCommand(session, event, message);
		return { agent: session.agent, session: session.id, status: "done", text: message };
	}

	return {
		async command(session, event) {
			const channel = event.conv?.split(":")[1];
			if (channel && options.channels?.has(channel)) {
				const command = await runChannelCommand(session, event, channelServices());
				if (command) return command;
			}
			if (event.type !== "message.in") return undefined;
			const { tier, subject } = await resolve(store, session, event);
			if (tier === "owner" || !subject) return undefined;
			if (config.defaults?.channelPolicy === "closed")
				return reject(session, event, tier, "channel_closed", closedMessage);
			const decision = await quota.remaining(subject);
			if (!decision.ok) return reject(session, event, tier, decision.reason, decision.message, decision.remaining);
			// 访客放行时记一轮，被拒的那一轮不占轮数；用量在运行结束后按实际 tokens 记。
			if (tier === "guest") await quota.charge(subject, 0, 1);
			return undefined;
		},
		async settle(id, run) {
			const tokens = run.usage.input + run.usage.output + run.usage.cacheRead + run.usage.cacheWrite;
			if (!tokens || (run.runId && (await store.events.runEnd(id, run.runId)))) return;
			const session = await store.sessions.get(id);
			if (!session) return;
			for (const input of run.inputs) {
				const event = await store.events.get(input);
				if (!event) continue;
				const { tier, subject } = await resolve(store, session, event);
				if (tier === "owner" || !subject) continue;
				await quota.charge(subject, tokens);
				return;
			}
		},
	};
}
