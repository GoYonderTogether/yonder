/**
 * 信号级别回答的是"要不要人管"，而不是"发生了什么"。
 * 历史问题是只有一种级别，预期内状态与真实故障同记 error，噪声淹掉了故障。
 */
export type SignalLevel = "error" | "warn" | "info";

/**
 * 稳定错误码：码给机器与文档用，message 给人看。
 * 只追加、不改既有含义——改含义会让历史日志与看板上的聚合结果对不上。
 */
export type SignalCode =
	| "recovery.missing-receipt" // 历史提交无原生回执：预期内 → warn
	| "recovery.settled-failed" // 结算失败 → error
	| "channel.transport-failed" // 渠道传输失败 → warn（由健康状态机聚合）
	| "channel.config-invalid" // 凭据/权限配置错误 → error
	| "plugin.observer-failed" // 插件事件观察者失败 → warn
	| "delivery.failed" // 投递失败 → error
	| "unknown"; // 未知 → warn（不要默认 error）

/**
 * 分级表。默认刻意偏 warn：判不清严重性时宁可不惊动人，
 * 因为"一律 error"正是每次启动 11,726 条噪声的来源。
 * error 只留给"不处理就会丢数据或丢消息"的情况。
 */
const LEVELS: Record<SignalCode, SignalLevel> = {
	"recovery.missing-receipt": "warn",
	"recovery.settled-failed": "error",
	"channel.transport-failed": "warn",
	"channel.config-invalid": "error",
	"plugin.observer-failed": "warn",
	"delivery.failed": "error",
	unknown: "warn",
};

export function levelOf(code: SignalCode): SignalLevel {
	// 运行时可能收到旧版本或插件传来的码，查不到时按 warn 处理，不能退化成 error。
	return LEVELS[code] ?? "warn";
}

/** 供接线层把外部字符串收敛到枚举：识别不了的一律归入 unknown。 */
export function isSignalCode(value: string): value is SignalCode {
	return Object.hasOwn(LEVELS, value);
}

function textOf(error: unknown): string {
	if (error instanceof Error) return error.message;
	return typeof error === "string" ? error : String(error);
}

/**
 * 从错误文本推断信号码。
 *
 * 为什么用文本匹配而不是改所有调用点：现有 onReport 有二十多处，签名统一是
 * (error) => void，一次全改风险大、收益小。先在这里做一层收敛，把"一律 error"
 * 这个最大噪声源消掉；后续新增调用点应直接传码。
 */
export function codeFor(error: unknown): SignalCode {
	const text = textOf(error);
	if (/无原生回执|missing receipt/i.test(text)) return "recovery.missing-receipt";
	if (/结算|settled/i.test(text)) return "recovery.settled-failed";
	if (/observer failed|Plugin event observer/i.test(text)) return "plugin.observer-failed";
	if (/投递|deliver/i.test(text)) return "delivery.failed";
	// 配置类：凭据、scope、鉴权失败。这些不会自愈，必须人处理。
	if (/invalid appid|invalid secret|scope|unauthorized|access denied|\b(401|403)\b|凭证|凭据/i.test(text))
		return "channel.config-invalid";
	if (/transport|ECONN|EPIPE|ECANCELED|socket|disconnect|网络|连接/i.test(text))
		return "channel.transport-failed";
	return "unknown";
}
