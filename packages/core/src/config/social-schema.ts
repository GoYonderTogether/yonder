import Type from "typebox";

const object = <T extends Record<string, import("typebox").TSchema>>(properties: T) =>
	Type.Object(properties, { additionalProperties: false });
const choice = (...values: string[]) => Type.Union(values.map((value) => Type.Literal(value)));
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
export const socialPolicySchema = object({
	mode: Type.Optional(choice("direct", "record", "mention", "batch", "folded", "mute")),
	batch: Type.Optional(
		object({
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
	quiet: Type.Optional(quietSchema),
	foldedEverySeconds: number(300, 86400),
	judge: Type.Optional(object({ preset: Type.String({ minLength: 1 }), maxCallsPerHour: number(1, 60) })),
});
export const socialSchema = object({
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
