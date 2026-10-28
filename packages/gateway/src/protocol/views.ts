import Type, { type Static } from "typebox";

const T = Type.String();
const N = Type.Number();
const B = Type.Boolean();
const O = Type.Optional;
const A = Type.Array;

export const ScopeSchema = Type.Union([
	Type.Literal("read"),
	Type.Literal("write"),
	Type.Literal("admin"),
	Type.Literal("owner"),
]);
export type Scope = Static<typeof ScopeSchema>;

export const PlacementSchema = Type.Union([Type.Literal("rail"), Type.Literal("floating"), Type.Literal("page")]);
export type Placement = Static<typeof PlacementSchema>;

export const BuiltinViewIdSchema = Type.Union([
	Type.Literal("todos"),
	Type.Literal("goal"),
	Type.Literal("subtasks"),
	Type.Literal("attachments"),
	Type.Literal("context"),
	Type.Literal("background"),
	Type.Literal("subagents"),
	Type.Literal("wakes"),
]);
export type BuiltinViewId = Static<typeof BuiltinViewIdSchema>;

export const ViewDeclSchema = Type.Object(
	{
		id: T,
		plugin: T,
		title: T,
		placement: PlacementSchema,
		scope: Type.Union([Type.Literal("session"), Type.Literal("node")]),
		data: O(T),
		icon: O(T),
		order: O(N),
		actions: O(A(T)),
		actScope: O(ScopeSchema),
		needs: O(Type.Object({ methods: O(A(T)) }, { additionalProperties: false })),
	},
	{ additionalProperties: false },
);
export type ViewDecl = Static<typeof ViewDeclSchema>;

export const ViewContentSchema = Type.Union([
	Type.Object({ type: Type.Literal("markdown"), text: T }, { additionalProperties: false }),
	Type.Object(
		{
			type: Type.Literal("list"),
			items: A(
				Type.Object(
					{
						id: T,
						title: T,
						subtitle: O(T),
						state: O(
							Type.Union([
								Type.Literal("todo"),
								Type.Literal("doing"),
								Type.Literal("done"),
								Type.Literal("error"),
								Type.Literal("info"),
							]),
						),
						actions: O(A(Type.Object({ id: T, label: T, danger: O(B) }, { additionalProperties: false }))),
					},
					{ additionalProperties: false },
				),
			),
		},
		{ additionalProperties: false },
	),
	Type.Object(
		{ type: Type.Literal("kv"), rows: A(Type.Object({ k: T, v: T }, { additionalProperties: false })) },
		{ additionalProperties: false },
	),
	Type.Object(
		{
			type: Type.Literal("choice"),
			prompt: T,
			options: A(Type.Object({ id: T, label: T }, { additionalProperties: false })),
			multi: O(B),
		},
		{ additionalProperties: false },
	),
	Type.Object(
		{ type: Type.Literal("input"), prompt: T, placeholder: O(T), secret: O(Type.Literal(false)) },
		{ additionalProperties: false },
	),
	Type.Object(
		{ type: Type.Literal("builtin"), id: BuiltinViewIdSchema, payload: Type.Unknown() },
		{ additionalProperties: false },
	),
]);
export type ViewContent = Static<typeof ViewContentSchema>;

export const ViewDataSchema = Type.Object(
	{ viewId: T, rev: N, content: ViewContentSchema, badge: O(N) },
	{ additionalProperties: false },
);
export type ViewData = Static<typeof ViewDataSchema>;

export const ViewsChangedEvSchema = Type.Object(
	{ placement: PlacementSchema, ids: A(T), badge: O(Type.Record(T, N)) },
	{ additionalProperties: false },
);
export type ViewsChangedEv = Static<typeof ViewsChangedEvSchema>;

export const ViewsListParamsSchema = Type.Object(
	{ placement: O(PlacementSchema), session: O(T) },
	{ additionalProperties: false },
);
export type ViewsListParams = Static<typeof ViewsListParamsSchema>;

export const ViewsListResultSchema = Type.Object({ views: A(ViewDeclSchema) }, { additionalProperties: false });
export type ViewsListResult = Static<typeof ViewsListResultSchema>;

export const ViewsWatchParamsSchema = Type.Object(
	{ placement: O(PlacementSchema), session: O(T) },
	{ additionalProperties: false },
);
export type ViewsWatchParams = Static<typeof ViewsWatchParamsSchema>;

export const ViewsWatchResultSchema = Type.Object({ views: A(ViewDeclSchema) }, { additionalProperties: false });
export type ViewsWatchResult = Static<typeof ViewsWatchResultSchema>;

export const ViewsDataParamsSchema = Type.Object({ viewId: T, session: O(T) }, { additionalProperties: false });
export type ViewsDataParams = Static<typeof ViewsDataParamsSchema>;

export const ViewsDataResultSchema = ViewDataSchema;
export type ViewsDataResult = Static<typeof ViewsDataResultSchema>;

export const ViewsActParamsSchema = Type.Object(
	{
		viewId: T,
		action: Type.String({ pattern: "^[a-z0-9][a-z0-9_.-]{0,63}$" }),
		input: O(Type.Union([Type.Null(), Type.Record(T, Type.Unknown())])),
		session: O(T),
	},
	{ additionalProperties: false },
);
export type ViewsActParams = Static<typeof ViewsActParamsSchema>;

export const ViewsActResultSchema = Type.Object({ content: O(ViewContentSchema) }, { additionalProperties: false });
export type ViewsActResult = Static<typeof ViewsActResultSchema>;
