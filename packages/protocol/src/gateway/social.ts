import Type from "typebox";

const text = Type.String({ minLength: 1 });
const policy = Type.Object({
	mode: Type.Optional(
		Type.Union(["direct", "record", "mention", "batch", "folded", "mute"].map((value) => Type.Literal(value))),
	),
	batch: Type.Optional(
		Type.Object({
			count: Type.Optional(Type.Integer()),
			delaySeconds: Type.Optional(Type.Integer()),
			maxMessages: Type.Optional(Type.Integer()),
			maxBytes: Type.Optional(Type.Integer()),
			run: Type.Optional(Type.Boolean()),
		}),
	),
	minIntervalSeconds: Type.Optional(Type.Integer()),
	signals: Type.Optional(
		Type.Record(Type.String(), Type.Union(["record", "consider", "respond"].map((value) => Type.Literal(value)))),
	),
	keywords: Type.Optional(Type.Array(Type.String())),
	quiet: Type.Optional(Type.Object({ timezone: text, start: text, end: text })),
	foldedEverySeconds: Type.Optional(Type.Integer()),
	judge: Type.Optional(Type.Object({ preset: text, maxCallsPerHour: Type.Optional(Type.Integer()) })),
});
export const SocialPolicyChangeEvSchema = Type.Object({
	actor: text,
	sourceEvent: Type.Optional(text),
	before: policy,
	after: policy,
	reason: text,
	revision: text,
	result: Type.Union([Type.Literal("applied"), Type.Literal("rejected")]),
});
