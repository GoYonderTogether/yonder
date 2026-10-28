import Type, { type Static } from "typebox";
import { ModelRefSchema, ModelStatusSchema } from "./model.js";
import { SessionInfoSchema } from "./session.js";

const T = Type.String();
const B = Type.Boolean();
const O = Type.Optional;

export const SessionsOpenParamsSchema = Type.Union([
	Type.Object(
		{
			preset: Type.String({ minLength: 1 }),
			agent: O(T),
			model: O(ModelRefSchema),
			workspace: O(T),
			cwd: O(T),
			title: O(T),
			prompt: O(T),
			close: O(Type.Union([Type.Literal("manual"), Type.Literal("run-end")])),
			parent: O(T),
			requestId: O(T),
		},
		{ additionalProperties: false },
	),
	Type.Object(
		{
			agent: Type.String({ minLength: 1 }),
			preset: O(T),
			model: O(ModelRefSchema),
			workspace: O(T),
			cwd: O(T),
			title: O(T),
			prompt: O(T),
			close: O(Type.Union([Type.Literal("manual"), Type.Literal("run-end")])),
			parent: O(T),
			requestId: O(T),
		},
		{ additionalProperties: false },
	),
]);
export type SessionsOpenParams = Static<typeof SessionsOpenParamsSchema>;

export const SessionsOpenResultSchema = Type.Object(
	{ session: SessionInfoSchema, model: O(ModelStatusSchema), deduped: O(B) },
	{ additionalProperties: false },
);
export type SessionsOpenResult = Static<typeof SessionsOpenResultSchema>;
