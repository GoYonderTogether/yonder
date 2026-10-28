import Type, { type Static } from "typebox";
import { OkSchema } from "./session.js";

const T = Type.String();
const N = Type.Number();
const B = Type.Boolean();
const O = Type.Optional;
const A = Type.Array;

export const NotifyLevelSchema = Type.Union([Type.Literal("all"), Type.Literal("mentions"), Type.Literal("mute")]);
export type NotifyLevel = Static<typeof NotifyLevelSchema>;

export const NotificationEvSchema = Type.Object(
	{ id: N, from: T, event: T, text: T, session: O(T), conv: O(T), channel: O(T) },
	{ additionalProperties: false },
);
export type NotificationEv = Static<typeof NotificationEvSchema>;

export const NotificationsPrefsGetParamsSchema = Type.Object({}, { additionalProperties: false });
export type NotificationsPrefsGetParams = Static<typeof NotificationsPrefsGetParamsSchema>;

export const NotificationsPrefsGetResultSchema = Type.Object(
	{ default: NotifyLevelSchema, conversations: Type.Record(T, NotifyLevelSchema) },
	{ additionalProperties: false },
);
export type NotificationsPrefsGetResult = Static<typeof NotificationsPrefsGetResultSchema>;

export const NotificationsPrefsSetParamsSchema = Type.Object(
	{ conv: T, level: Type.Union([NotifyLevelSchema, Type.Null()]) },
	{ additionalProperties: false },
);
export type NotificationsPrefsSetParams = Static<typeof NotificationsPrefsSetParamsSchema>;

export const NotificationsPrefsSetResultSchema = OkSchema;
export type NotificationsPrefsSetResult = Static<typeof NotificationsPrefsSetResultSchema>;

export const SuggestionSchema = Type.Object(
	{
		id: T,
		session: T,
		by: T,
		kind: Type.Union([Type.Literal("organize"), Type.Literal("nudge"), Type.Literal("followup")]),
		title: T,
		body: T,
		createdAt: T,
		state: Type.Union([Type.Literal("pending"), Type.Literal("accepted"), Type.Literal("dismissed")]),
	},
	{ additionalProperties: false },
);
export type Suggestion = Static<typeof SuggestionSchema>;

export const SuggestionCreatedEvSchema = Type.Object({ suggestion: SuggestionSchema }, { additionalProperties: false });
export type SuggestionCreatedEv = Static<typeof SuggestionCreatedEvSchema>;

export const SuggestionsListParamsSchema = Type.Object({ session: O(T) }, { additionalProperties: false });
export type SuggestionsListParams = Static<typeof SuggestionsListParamsSchema>;

export const SuggestionsListResultSchema = Type.Object({ items: A(SuggestionSchema) }, { additionalProperties: false });
export type SuggestionsListResult = Static<typeof SuggestionsListResultSchema>;

export const SuggestionsActParamsSchema = Type.Object(
	{ id: T, action: Type.Union([Type.Literal("accept"), Type.Literal("dismiss")]) },
	{ additionalProperties: false },
);
export type SuggestionsActParams = Static<typeof SuggestionsActParamsSchema>;

export const SuggestionsActResultSchema = Type.Object(
	{ state: Type.Union([Type.Literal("accepted"), Type.Literal("dismissed")]), first: B },
	{ additionalProperties: false },
);
export type SuggestionsActResult = Static<typeof SuggestionsActResultSchema>;
