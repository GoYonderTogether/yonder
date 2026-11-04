import type { DeliveryService } from "@yonder/bot-core/delivery/index";
import { createQuota, type OutsiderSubject, type QuotaRejectionReason } from "@yonder/bot-core/kernel/quota";
import { runChannelCommand } from "@yonder/bot-core/routing/commands";
import type { createSessions } from "@yonder/bot-core/sessions/index";
import type { SkillsReport } from "@yonder/bot-core/skills/index";
import type { Store } from "@yonder/bot-core/store/contracts";
import { parentOrigins } from "@yonder/bot-core/tools/parent-origin";
import type { YonderConfig } from "@yonder/bot-definition";
import type { RuntimeRun, RuntimeSessionConfig } from "@yonder/runtime-adapter";
import type { ChannelLoginResult, RunResult, SessionInfo, YEvent } from "@yonder/sdk";

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
	config: YonderConfig;
	/** 已配置的渠道实例；其余来源不走渠道命令，也不消费额度。 */
	channels?: { has(name: string): boolean };
	now?: () => number;
}

export interface QuotaWire {
	/** 渠道命令与外人额度闸门：返回结果表示这一轮已经处理完毕，不再交给模型。 */
	command(session: SessionInfo, event: YEvent): Promise<RunResult | undefined>;
	/** 将实际用量与 run.end 原子写入；主人与 bot 自己的会话只记录 run.end。 */
	settle(id: string, run: RuntimeRun, ending: Parameters<Store["events"]["recordRun"]>[0]): Promise<void>;
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
async function resolve(store: Store, session: SessionInfo, event: YEvent): Promise<Resolved[] | undefined> {
	const parent = (event.data as { kind?: string }).kind === "parent-request";
	const origins = parent ? await parentOrigins(store, event, session.agent ?? "main") : undefined;
	if (parent && !origins) return;
	const inputs = origins ?? [event];
	const subjects = new Map<string, Resolved>();
	for (const input of inputs) {
		const from = input.from;
		if (!parent && (!from?.startsWith("acct:") || session.owner?.kind === "bot")) continue;
		if (
			(!parent || origins) &&
			from?.startsWith("acct:") &&
			(await store.identity().relation(session.agent ?? "main", from)) === "owner"
		)
			continue;
		const person = from?.startsWith("acct:") ? (await store.identity().account(from))?.person : undefined;
		const subject: OutsiderSubject = person
			? { kind: "person", person }
			: { kind: "guest", qr: input.conv ?? event.conv ?? "unknown", source: from ?? "unknown" };
		subjects.set(JSON.stringify(subject), { tier: person ? "person" : "guest", subject });
	}
	return [...subjects.values()];
}

export function quotaWire(options: QuotaWireOptions): QuotaWire {
	const { config, store } = options;
	const quota = createQuota({
		store: store.quota,
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
		tier: OutsiderTier | undefined,
		reason: QuotaRejectionReason | "channel_closed" | "parent-origin-unverified",
		message: string,
		remaining = 0,
	): Promise<RunResult> {
		await store.events.record({
			type: "outsider.rejected",
			parent: event.id,
			...(event.from ? { from: event.from } : {}),
			...(event.conv ? { conv: event.conv } : {}),
			data: { session: session.id, ...(tier ? { tier } : {}), reason, remaining, login: "/connect", hint: message },
		});
		if (event.conv) await options.delivery.sendCommand(session, event, message);
		return { agent: session.agent, session: session.id, status: "error", reason, text: message };
	}

	return {
		async command(session, event) {
			const channel = event.conv?.split(":")[1];
			if (channel && options.channels?.has(channel)) {
				const command = await runChannelCommand(session, event, channelServices());
				if (command) return command;
			}
			if (event.type !== "message.in") return undefined;
			const resolved = await resolve(store, session, event);
			if (!resolved)
				return reject(
					session,
					event,
					undefined,
					"parent-origin-unverified",
					"无法核验 parent_ask 的原始请求来源；未运行模型或扣除访客额度。请检查持久来源事件和分身路由，不要把它当作主人授权或外人额度不足。",
				);
			for (const { tier, subject } of resolved) {
				if (!subject) continue;
				if (config.defaults?.channelPolicy === "closed")
					return reject(session, event, tier, "channel_closed", closedMessage);
				const decision = await quota.remaining(subject);
				if (!decision.ok) return reject(session, event, tier, decision.reason, decision.message, decision.remaining);
			}
			for (const { tier, subject } of resolved) if (tier === "guest" && subject) await quota.charge(subject, 0, 1);
			return undefined;
		},
		async settle(id, run, ending) {
			const tokens = run.usage.input + run.usage.output + run.usage.cacheRead + run.usage.cacheWrite;
			let subject: OutsiderSubject | undefined;
			const session = await store.sessions.get(id);
			if (tokens && session) {
				for (const input of run.inputs) {
					const event = await store.events.get(input);
					if (!event) continue;
					subject = (await resolve(store, session, event))?.[0]?.subject;
					if (subject) break;
				}
			}
			await store.events.recordRun(ending, async (ledger) => {
				if (subject) {
					await createQuota({
						store: ledger,
						outsiders: config.outsiders ?? {},
						...(config.timezone ? { timezone: config.timezone } : {}),
						...(options.now ? { now: options.now } : {}),
					}).charge(subject, tokens);
				}
			});
		},
	};
}
