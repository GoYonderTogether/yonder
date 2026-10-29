import { defaultOutsiders } from "../config/defaults.js";
import { tokenAmount, type YonderConfig } from "../config/index.js";
import type { Db } from "../runtime/db.js";
import { quotaStore } from "../store/quota.js";

type Outsiders = NonNullable<YonderConfig["outsiders"]>;

/**
 * 访客防滥用上限的缺省值（IMP-19 定值）：一个分享二维码每天最多 5 万 token（缺省分享池的十分之一），
 * 同一来源每天最多 6 轮（访客 3 轮的两倍，够重进一次、挡批量换身份）。
 */
export const guestLimitDefaults = { perQrDailyTokens: 50_000, perSourceDailyRounds: 6 };

/** 被计量的人：已绑定账号的登录外人，或扫码进来的访客（二维码 + 来源双键，来源是设备/IP 的哈希替身）。 */
export type OutsiderSubject = { kind: "guest"; qr: string; source: string } | { kind: "person"; person: string };

export type QuotaRejectionReason =
	| "guest_qr_tokens"
	| "guest_rounds"
	| "guest_source_rounds"
	| "owner_share_exhausted"
	| "person_daily_limit";

/** 结构化判定：`ok: false` 带原因与渠道可直接回给人的引导语，`remaining` 是还能用的 token 数。 */
export type QuotaDecision =
	| { ok: true; remaining: number }
	| { message: string; ok: false; reason: QuotaRejectionReason; remaining: number };

/** 主人时区下的日界线：`YYYY-MM-DD`，跨时区不会在半夜换错天。 */
export function quotaDay(now: number, timezone: string): string {
	const parts = new Intl.DateTimeFormat("en-US", {
		day: "2-digit",
		month: "2-digit",
		timeZone: timezone,
		year: "numeric",
	}).formatToParts(new Date(now));
	const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
	return `${part("year")}-${part("month")}-${part("day")}`;
}

export interface QuotaOptions {
	db: Db;
	outsiders: Outsiders;
	/** 主人时区；缺省与配置缺省一致。 */
	timezone?: string;
	now?: () => number;
}

/**
 * 外人额度账本（IMP-19）：主人分享池、每人每日上限、访客轮数与防批量上限。
 * 判定与记账都在这里，渠道怎么引导登录、内核什么时候调用由接入方决定（IMP-25）。
 */
export function createQuota(options: QuotaOptions) {
	const { db } = options;
	const now = options.now ?? Date.now;
	const timezone = options.timezone ?? "Asia/Shanghai";
	const store = quotaStore(db);
	// 配置解析已补齐缺省；这里再合一次，只为让缺省值只有一个来源（`config/defaults.ts`）。
	const defaults = defaultOutsiders as Required<Outsiders>;
	const settings = { ...defaults, ...options.outsiders };
	const ownerShareDailyTokens = tokenAmount(settings.ownerShareDailyTokens);
	const perPersonDailyTokens = tokenAmount(settings.perPersonDailyTokens);
	const guestMaxRounds = settings.guestMaxRounds;
	const requireLoginForQuota = settings.requireLoginForQuota;
	const perQrDailyTokens =
		settings.guestPerQrDailyTokens === undefined
			? guestLimitDefaults.perQrDailyTokens
			: tokenAmount(settings.guestPerQrDailyTokens);
	const perSourceDailyRounds = settings.guestPerSourceDailyRounds ?? guestLimitDefaults.perSourceDailyRounds;
	const messages: Record<QuotaRejectionReason, string> = {
		guest_qr_tokens: "这个分享二维码今天的额度已用完，明天再来，或登录绑定后继续聊。",
		guest_rounds: `访客对话最多 ${guestMaxRounds} 轮，这一轮没有回复。登录绑定后可以按每日额度继续聊。`,
		guest_source_rounds: "这台设备今天的访客对话次数已用完，登录绑定后可以继续聊。",
		owner_share_exhausted: "主人今天分享给外人的额度已用完，明天再来。",
		person_daily_limit: "今天的额度已用完，明天再来。",
	};
	const day = () => quotaDay(now(), timezone);
	const reject = (reason: QuotaRejectionReason, remaining: number): QuotaDecision => ({
		message: messages[reason],
		ok: false,
		reason,
		remaining: Math.max(0, remaining),
	});
	const roundsKey = (guest: { qr: string; source: string }) => `${guest.qr}\u0000${guest.source}`;

	async function guestUsed(guest: { qr: string; source: string }, today: string) {
		const [rounds, source, qr] = await Promise.all([
			store.get(today, "guest_rounds", roundsKey(guest)),
			store.get(today, "guest_source", guest.source),
			store.get(today, "guest_qr", guest.qr),
		]);
		return { qrTokens: qr.tokens, rounds: rounds.rounds, sourceRounds: source.rounds };
	}

	/** 调用前检查：还能不能用、还能用多少。拒绝时带原因和引导语。 */
	async function remaining(subject: OutsiderSubject): Promise<QuotaDecision> {
		const today = day();
		const poolLeft = ownerShareDailyTokens - (await store.get(today, "owner", "share")).tokens;
		if (poolLeft <= 0) return reject("owner_share_exhausted", poolLeft);
		if (subject.kind === "person") {
			const left = Math.min(poolLeft, perPersonDailyTokens - (await store.get(today, "person", subject.person)).tokens);
			return left <= 0 ? reject("person_daily_limit", left) : { ok: true, remaining: left };
		}
		const used = await guestUsed(subject, today);
		if (used.rounds >= guestMaxRounds) return reject("guest_rounds", poolLeft);
		if (used.sourceRounds >= perSourceDailyRounds) return reject("guest_source_rounds", poolLeft);
		const qrLeft = perQrDailyTokens - used.qrTokens;
		if (qrLeft <= 0) return reject("guest_qr_tokens", qrLeft);
		let left = Math.min(poolLeft, qrLeft);
		// 要求登录才计入个人额度：未登录的访客不进个人账；关掉这项时访客也按每人每日上限封顶。
		if (!requireLoginForQuota) {
			const ownLeft = perPersonDailyTokens - (await store.get(today, "person", `guest:${subject.source}`)).tokens;
			if (ownLeft <= 0) return reject("person_daily_limit", ownLeft);
			left = Math.min(left, ownLeft);
		}
		return { ok: true, remaining: left };
	}

	/** 调用后记账：`tokens` 记进主人分享池与被计量对象，`rounds` 只对访客轮数有意义。 */
	async function charge(subject: OutsiderSubject, tokens: number, rounds = 0): Promise<QuotaDecision> {
		const today = day();
		await store.add(today, "owner", "share", tokens);
		if (subject.kind === "person") {
			await store.add(today, "person", subject.person, tokens, rounds);
		} else {
			await store.add(today, "guest_qr", subject.qr, tokens);
			await store.add(today, "guest_rounds", roundsKey(subject), 0, rounds);
			await store.add(today, "guest_source", subject.source, 0, rounds);
			if (!requireLoginForQuota) await store.add(today, "person", `guest:${subject.source}`, tokens, rounds);
		}
		return remaining(subject);
	}

	/** 访客今天在这个二维码下已经用掉的轮数。 */
	async function guestRounds(guest: { qr: string; source: string }): Promise<number> {
		return (await store.get(day(), "guest_rounds", roundsKey(guest))).rounds;
	}

	return { charge, day, guestRounds, remaining };
}
export type Quota = ReturnType<typeof createQuota>;
