import type { AgentConfig, YonderConfig } from "./schema.js";
import { socialDefaults } from "./social-schema.js";

/** 兜底链缺省（QA 10-28 23:40）：免费池在前，其次 glm-5.3-flash；条目可为 provider 或 provider/model。 */
export const defaultModelChain = ["workbuddy", "rightapi-glm/glm-5.3-flash"];
/** 按量付费模型的价格上限（元/百万 token）：输入与输出单价都不得超过。 */
export const defaultPriceCapPerMTokenYuan = 0.6;
/** 会话预算缺省：token 不限（0），超预算只记录不中断（M3/M5）。 */
export const defaultBudget = { tokens: 0, overBudget: "record" as const };
/** 外人额度缺省（QA Q2/Q3）：主人分享池 50 万，每人每天 300 万，访客 3 轮。 */
export const defaultOutsiders: NonNullable<YonderConfig["outsiders"]> = {
	ownerShareDailyTokens: 500_000,
	perPersonDailyTokens: 3_000_000,
	requireLoginForQuota: true,
	guestMaxRounds: 3,
	capabilities: ["chat", "web_search", "public_docs"],
	publicDocs: [],
};

/** `outsiders.*` 的额度值：整数原样返回，`500K` / `2M` 按十进制单位换算成 token 数。 */
export function tokenAmount(value: number | string): number {
	if (typeof value === "number") return value;
	return Math.round(Number(value.slice(0, -1)) * (value.endsWith("M") ? 1_000_000 : 1_000));
}

/**
 * 补齐 social 里没写的监听、标签、快照与机器人闸门参数（QA C2/C3/C5）。`social` 整块缺省时
 * 保持缺省，消费者用 `socialDefaults` 兜底，旧配置的“没有 social”语义不变。
 */
export function socialWithDefaults(social: NonNullable<AgentConfig["social"]>): NonNullable<AgentConfig["social"]> {
	const listen = social.listen;
	return {
		...social,
		listen: {
			...socialDefaults.listen,
			...listen,
			realtime: { ...socialDefaults.listen.realtime, ...listen?.realtime },
			batch: { ...socialDefaults.listen.batch, ...listen?.batch },
			digest: { ...socialDefaults.listen.digest, ...listen?.digest },
			mention: { ...socialDefaults.listen.mention, ...listen?.mention },
		},
		tags: { ...socialDefaults.tags, ...social.tags },
		snapshot: { ...socialDefaults.snapshot, ...social.snapshot },
		botGate: { ...socialDefaults.botGate, ...social.botGate },
		judge: { ...socialDefaults.judge, ...social.judge },
	};
}
