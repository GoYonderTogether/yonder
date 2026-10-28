import Type, { type Static } from "typebox";

const T = Type.String();
const N = Type.Number();
const B = Type.Boolean();
const O = Type.Optional;
const A = Type.Array;

export const UsageTotalsSchema = Type.Object(
	{ input: N, output: N, cacheRead: N, cacheWrite: N, cost: N },
	{ additionalProperties: false },
);
export type UsageTotals = Static<typeof UsageTotalsSchema>;

export const UsageLastSchema = Type.Object(
	{ input: N, output: N, cacheRead: N, cacheWrite: N, cost: N, cacheHitPct: N },
	{ additionalProperties: false },
);
export type UsageLast = Static<typeof UsageLastSchema>;

export const UsageUpdatedEvSchema = Type.Object(
	{
		session: T,
		scope: Type.Union([Type.Literal("self"), Type.Literal("children")]),
		totals: UsageTotalsSchema,
		last: O(UsageLastSchema),
	},
	{ additionalProperties: false },
);
export type UsageUpdatedEv = Static<typeof UsageUpdatedEvSchema>;

export const ContextUpdatedEvSchema = Type.Object(
	{ session: T, tokens: N, window: N, percent: Type.Number({ minimum: 0, maximum: 100 }), auto: B },
	{ additionalProperties: false },
);
export type ContextUpdatedEv = Static<typeof ContextUpdatedEvSchema>;

export const CompactionEvSchema = Type.Object(
	{
		session: T,
		kind: Type.Union([Type.Literal("auto"), Type.Literal("manual"), Type.Literal("background")]),
		before: N,
		after: O(N),
		ms: O(N),
		ok: O(B),
	},
	{ additionalProperties: false },
);
export type CompactionEv = Static<typeof CompactionEvSchema>;

export const UsageSnapshotSchema = Type.Object(
	{
		self: UsageTotalsSchema,
		children: O(UsageTotalsSchema),
		last: O(UsageLastSchema),
		lsp: O(Type.Object({ name: T, state: T }, { additionalProperties: false })),
	},
	{ additionalProperties: false },
);
export type UsageSnapshot = Static<typeof UsageSnapshotSchema>;

export const ContextSnapshotSchema = Type.Object(
	{
		tokens: N,
		window: N,
		percent: Type.Number({ minimum: 0, maximum: 100 }),
		auto: B,
		parts: O(A(Type.Object({ name: T, tokens: N }, { additionalProperties: false }))),
	},
	{ additionalProperties: false },
);
export type ContextSnapshot = Static<typeof ContextSnapshotSchema>;
