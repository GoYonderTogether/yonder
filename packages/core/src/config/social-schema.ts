import Type, { type Static, type TLiteral } from "typebox";

const object = <T extends Record<string, import("typebox").TSchema>>(properties: T) =>
	Type.Object(properties, { additionalProperties: false });
const choice = (...values: string[]) => Type.Union(values.map((value) => Type.Literal(value)));
/** 带字面量类型的枚举，供新增键的缺省值做类型检查。 */
const literals = <const T extends [string, ...string[]]>(...values: T) =>
	Type.Union(values.map((value) => Type.Literal(value)) as [TLiteral<T[number]>, ...TLiteral<T[number]>[]]);
const ref = (kinds: string) =>
	Type.String({
		pattern: `^(?:${kinds
			.split("|")
			.map((kind) => (kind === "person" ? "person:[^\\s]+" : `${kind}:[a-z0-9-]+:[^\\s]+`))
			.join("|")})$`,
	});
const number = (minimum: number, maximum: number) => Type.Optional(Type.Integer({ minimum, maximum }));
export const quietSchema = object({
	timezone: Type.String({ minLength: 1 }),
	start: Type.String({ pattern: "^([01][0-9]|2[0-3]):[0-5][0-9]$" }),
	end: Type.String({ pattern: "^([01][0-9]|2[0-3]):[0-5][0-9]$" }),
});
const signal = Type.Optional(choice("record", "consider", "respond"));
/** 群的两个维度标签：对主人的价值与消息节奏；可写在 social.tags 或单个会话策略里覆盖。 */
export const socialTagsSchema = object({
	value: Type.Optional(literals("high", "medium", "low")),
	rhythm: Type.Optional(literals("low", "normal", "high")),
});
const socialTriggersSchema = object({
	regex: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 256 }), { maxItems: 16 })),
	exclude: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
	minLength: Type.Optional(Type.Integer({ minimum: 0 })),
	maxLength: Type.Optional(Type.Integer({ minimum: 0 })),
});
/** Finite native regex syntax: no groups, repetition, or backreferences. */
export function socialTriggerErrors(triggers?: Static<typeof socialTriggersSchema>): string[] {
	const errors: string[] = [];
	if (triggers?.minLength !== undefined && triggers.maxLength !== undefined && triggers.minLength > triggers.maxLength)
		errors.push("triggers/minLength 不得大于 maxLength");
	for (const [index, pattern] of (triggers?.regex ?? []).entries()) {
		let characterClass = false;
		let unsupported = false;
		for (let i = 0; i < pattern.length; i++) {
			const char = pattern[i];
			if (char === "\\") {
				const next = pattern[++i] ?? "";
				if (!characterClass && (/[1-9]/.test(next) || (next === "k" && pattern[i + 1] === "<"))) unsupported = true;
			} else if (char === "[") characterClass = true;
			else if (char === "]") characterClass = false;
			else if (!characterClass && /[()*+?{}]/.test(char ?? "")) unsupported = true;
		}
		if (unsupported) errors.push(`triggers/regex/${index}: 仅支持字面、字符类、.、^、$、|；禁止分组、量词和反向引用`);
		else {
			try {
				new RegExp(pattern);
			} catch {
				errors.push(`triggers/regex/${index}: 无效正则表达式`);
			}
		}
	}
	return errors;
}
export const socialPolicySchema = object({
	plugin: Type.Optional(Type.String({ pattern: "^[a-z0-9][a-z0-9-]*$" })),
	tags: Type.Optional(socialTagsSchema),
	mode: Type.Optional(choice("direct", "record", "mention", "batch", "folded", "mute")),
	batch: Type.Optional(
		object({
			run: Type.Optional(Type.Boolean()),
			count: number(1, 100),
			delaySeconds: number(1, 3600),
			maxMessages: number(1, 100),
			maxBytes: number(1024, 65536),
		}),
	),
	minIntervalSeconds: number(1, 3600),
	signals: Type.Optional(
		object({ botMention: signal, ownerMention: signal, groupOwner: signal, everyone: signal, keyword: signal }),
	),
	keywords: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 64 }), { maxItems: 32 })),
	triggers: Type.Optional(socialTriggersSchema),
	quiet: Type.Optional(quietSchema),
	foldedEverySeconds: number(300, 86400),
	judge: Type.Optional(object({ preset: Type.String({ minLength: 1 }), maxCallsPerHour: number(1, 60) })),
});
/** 收消息的方式与频率参数：realtime 全部接收，batch/mention/digest 各自控频（QA C2）。 */
export const socialListenSchema = object({
	mode: Type.Optional(literals("realtime", "batch", "mention", "digest")),
	realtime: Type.Optional(object({ quietSec: number(1, 600), maxWindowSec: number(1, 3600) })),
	batch: Type.Optional(
		object({
			windowSec: number(1, 86400),
			keyRules: Type.Optional(Type.Array(literals("owner", "link", "image"), { maxItems: 8 })),
		}),
	),
	digest: Type.Optional(
		object({
			windowMin: Type.Optional(Type.Union([Type.Literal(15), Type.Literal(30)])),
			minMessages: number(1, 1000),
		}),
	),
	mention: Type.Optional(object({ strong: Type.Optional(Type.Boolean()) })),
});
export const socialSchema = object({
	scope: Type.Optional(Type.Array(ref("conv"))),
	enabled: Type.Optional(Type.Boolean()),
	authorized: Type.Optional(
		object({
			people: Type.Optional(Type.Array(ref("person"))),
			accounts: Type.Optional(Type.Array(ref("acct"))),
			conversations: Type.Optional(Type.Array(ref("conv"))),
		}),
	),
	friends: Type.Optional(Type.Array(ref("person|acct"))),
	denied: Type.Optional(Type.Array(ref("person|acct|conv"))),
	defaults: Type.Optional(
		object({
			dm: Type.Optional(socialPolicySchema),
			group: Type.Optional(socialPolicySchema),
			channel: Type.Optional(socialPolicySchema),
		}),
	),
	conversations: Type.Optional(Type.Record(ref("conv"), socialPolicySchema, { additionalProperties: false })),
	mappings: Type.Optional(
		Type.Array(
			object({
				subject: ref("person|acct|conv"),
				agent: Type.String({ minLength: 1 }),
				profile: Type.String({ minLength: 1 }),
			}),
		),
	),
	/** 收消息方式与控频；默认 realtime 全部接收（QA C2）。 */
	listen: Type.Optional(socialListenSchema),
	/** 群标签默认值；单个会话策略里的 tags 覆盖它（QA C2/C3）。 */
	tags: Type.Optional(socialTagsSchema),
	/** 超频时合并成群快照、下次回复一次读完未读（QA C2）。 */
	snapshot: Type.Optional(object({ enabled: Type.Optional(Type.Boolean()) })),
	/** 群判定与价值评估用的模型：模型槽名（cheap/simple）或 provider/model（IMP-15）。 */
	judge: Type.Optional(object({ model: Type.Optional(Type.String({ minLength: 1 })) })),
	/** 别的机器人按真人对待，另加闸门（QA C5）：窗口内条数超过阈值就注入提示。 */
	botGate: Type.Optional(object({ windowMin: number(1, 1440), threshold: number(1, 100), history: number(1, 20) })),
});
export const outboundSchema = object({
	enabled: Type.Optional(Type.Boolean()),
	mode: Type.Optional(choice("off", "digest", "immediate")),
	digestEverySeconds: number(300, 86400),
	maxItems: number(1, 20),
	quiet: Type.Optional(quietSchema),
	decisionRepeat: Type.Optional(Type.Literal("never")),
	target: Type.Optional(object({ to: ref("acct|conv"), via: Type.String({ pattern: "^[a-z0-9-]+$" }) })),
});

/**
 * 缺省的收消息、标签、快照与机器人闸门参数（QA C2/C3/C5）。配置里没写时由 `parseAgentConfig`
 * 补全，插件读到的形状始终一致；`social` 整块缺省时消费者用这里的值兜底。
 */
export const socialDefaults: Required<
	Pick<Static<typeof socialSchema>, "listen" | "tags" | "snapshot" | "botGate" | "judge">
> = {
	listen: {
		mode: "realtime",
		realtime: { quietSec: 15, maxWindowSec: 120 },
		batch: { windowSec: 300, keyRules: ["owner", "link", "image"] },
		digest: { windowMin: 15, minMessages: 5 },
		mention: { strong: true },
	},
	tags: { value: "medium", rhythm: "normal" },
	snapshot: { enabled: true },
	botGate: { windowMin: 15, threshold: 3, history: 3 },
	/** 判定与价值评估走便宜模型槽（IMP-15）。 */
	judge: { model: "cheap" },
};
