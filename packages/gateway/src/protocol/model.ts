import Type, { type Static } from "typebox";

const T = Type.String();
const N = Type.Number();
const B = Type.Boolean();
const O = Type.Optional;

export const ModelRefSchema = Type.Object({ provider: T, model: T, thinking: O(T) }, { additionalProperties: false });
export type ModelRef = Static<typeof ModelRefSchema>;

export const ModelStatusSchema = Type.Object(
	{ provider: T, model: T, thinking: O(T), contextWindow: O(N), routedTo: O(ModelRefSchema) },
	{ additionalProperties: false },
);
export type ModelStatus = Static<typeof ModelStatusSchema>;

export const ModelChangedEvSchema = Type.Object(
	{
		session: T,
		from: O(ModelRefSchema),
		to: ModelStatusSchema,
		cause: Type.Union([Type.Literal("user"), Type.Literal("route"), Type.Literal("fallback"), Type.Literal("recover")]),
	},
	{ additionalProperties: false },
);
export type ModelChangedEv = Static<typeof ModelChangedEvSchema>;

export const ModelFallbackEvSchema = Type.Object(
	{
		session: T,
		state: Type.Union([Type.Literal("fallback"), Type.Literal("recovered")]),
		from: ModelRefSchema,
		to: ModelRefSchema,
		reason: Type.Union([
			Type.Literal("rate_limit"),
			Type.Literal("quota"),
			Type.Literal("unavailable"),
			Type.Literal("error"),
		]),
	},
	{ additionalProperties: false },
);
export type ModelFallbackEv = Static<typeof ModelFallbackEvSchema>;

export const ReplyFailedEvSchema = Type.Object(
	{ session: T, notice: Type.String({ minLength: 1, pattern: "[\\u3400-\\u9fff]" }), willRetry: B },
	{ additionalProperties: false },
);
export type ReplyFailedEv = Static<typeof ReplyFailedEvSchema>;

export const SessionsModelSetParamsSchema = Type.Object(
	{ id: T, model: ModelRefSchema },
	{ additionalProperties: false },
);
export type SessionsModelSetParams = Static<typeof SessionsModelSetParamsSchema>;

export const SessionsModelSetResultSchema = Type.Object({ model: ModelStatusSchema }, { additionalProperties: false });
export type SessionsModelSetResult = Static<typeof SessionsModelSetResultSchema>;
