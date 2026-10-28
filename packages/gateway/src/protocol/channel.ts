import Type, { type Static } from "typebox";

const T = Type.String();
const N = Type.Number();
const B = Type.Boolean();
const O = Type.Optional;
const A = Type.Array;

export const EventQuerySchema = Type.Object(
	{ id: O(T), type: O(T), from: O(T), conv: O(T), agent: O(T), since: O(T), until: O(T), after: O(T), limit: O(N) },
	{ additionalProperties: false },
);
export type EventQuery = Static<typeof EventQuerySchema>;

export const YEventSchema = Type.Object(
	{
		id: T,
		ts: T,
		type: T,
		parent: O(T),
		from: O(T),
		conv: O(T),
		data: Type.Object({}),
		routes: O(
			A(
				Type.Object(
					{
						agent: T,
						binding: Type.Union([T, Type.Null()]),
						session: O(T),
						wake: O(Type.Union([Type.Literal("run"), Type.Literal("write")])),
						busy: O(Type.Union([Type.Literal("followup"), Type.Literal("steer"), Type.Literal("interrupt")])),
						waiting: O(B),
						dropped: O(
							Type.Union([
								Type.Literal("no-binding"),
								Type.Literal("agent-disabled"),
								Type.Literal("profile-mismatch"),
							]),
						),
					},
					{ additionalProperties: false },
				),
			),
		),
	},
	{ additionalProperties: false },
);
export type YEvent = Static<typeof YEventSchema>;

export const EventPageSchema = Type.Object({ events: A(YEventSchema), next: O(T) }, { additionalProperties: false });
export type EventPage = Static<typeof EventPageSchema>;

export const EventsQueryParamsSchema = EventQuerySchema;
export type EventsQueryParams = Static<typeof EventsQueryParamsSchema>;

export const EventsQueryResultSchema = EventPageSchema;
export type EventsQueryResult = Static<typeof EventsQueryResultSchema>;
