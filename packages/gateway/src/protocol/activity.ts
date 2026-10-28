import Type, { type Static } from "typebox";

const T = Type.String();
const N = Type.Number();
const O = Type.Optional;
const A = Type.Array;

export const ActivitySummarySchema = Type.Object(
	{
		running: N,
		waiting: N,
		suggestions: O(N),
		sessions: A(
			Type.Object(
				{
					id: T,
					state: Type.Union([
						Type.Literal("running"),
						Type.Literal("waiting"),
						Type.Literal("idle"),
						Type.Literal("error"),
					]),
					since: T,
				},
				{ additionalProperties: false },
			),
		),
	},
	{ additionalProperties: false },
);
export type ActivitySummary = Static<typeof ActivitySummarySchema>;

export const ActivitySummaryParamsSchema = Type.Object({ since: O(T) }, { additionalProperties: false });
export type ActivitySummaryParams = Static<typeof ActivitySummaryParamsSchema>;

export const ActivitySummaryResultSchema = ActivitySummarySchema;
export type ActivitySummaryResult = Static<typeof ActivitySummaryResultSchema>;

export const ActivityWatchParamsSchema = Type.Object({}, { additionalProperties: false });
export type ActivityWatchParams = Static<typeof ActivityWatchParamsSchema>;

export const ActivityWatchResultSchema = ActivitySummarySchema;
export type ActivityWatchResult = Static<typeof ActivityWatchResultSchema>;

export const SessionSettledEvSchema = Type.Object(
	{
		session: T,
		status: Type.Union([Type.Literal("idle"), Type.Literal("done"), Type.Literal("error"), Type.Literal("aborted")]),
	},
	{ additionalProperties: false },
);
export type SessionSettledEv = Static<typeof SessionSettledEvSchema>;

/** Compatibility event from the existing activity.watch producer; its handler is unchanged. */
export const ActivitySummaryEvSchema = Type.Union([
	ActivitySummarySchema,
	Type.Object(
		{
			running: N,
			waiting: N,
			sessions: A(
				Type.Object(
					{
						id: T,
						agent: T,
						state: Type.Union([
							Type.Literal("running"),
							Type.Literal("waiting"),
							Type.Literal("idle"),
							Type.Literal("error"),
						]),
					},
					{ additionalProperties: false },
				),
			),
		},
		{ additionalProperties: false },
	),
]);
export type ActivitySummaryEv = Static<typeof ActivitySummaryEvSchema>;
