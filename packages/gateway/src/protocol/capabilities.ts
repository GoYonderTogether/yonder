import Type, { type Static } from "typebox";
import { ScopeSchema, ViewDeclSchema } from "./views.js";

const T = Type.String();
const N = Type.Number();
const B = Type.Boolean();
const O = Type.Optional;
const A = Type.Array;

export const MethodFactsSchema = Type.Object(
	{ scope: ScopeSchema, stream: O(Type.Literal(true)), local: O(Type.Literal(true)), since: N },
	{ additionalProperties: false },
);
export type MethodFacts = Static<typeof MethodFactsSchema>;

export const NodeFactsSchema = Type.Object(
	{
		protocol: N,
		minor: N,
		kind: Type.Union([Type.Literal("local"), Type.Literal("remote")]),
		version: Type.Object({ yonder: T, commit: Type.Union([T, Type.Null()]) }, { additionalProperties: false }),
		node: Type.Object({ id: T, name: T }, { additionalProperties: false }),
		methods: Type.Record(T, MethodFactsSchema),
		events: A(T),
		plugins: A(Type.Object({ id: T, version: T, views: A(T), tools: O(A(T)) }, { additionalProperties: false })),
		granted: A(ScopeSchema),
		views: A(ViewDeclSchema),
		models: Type.Object({ select: B }, { additionalProperties: false }),
		remoteSession: Type.Object(
			{ create: B, modes: A(T), agents: A(T), workspaces: B },
			{ additionalProperties: false },
		),
		features: Type.Object(
			{
				requestIdDedupe: B,
				resumableWatch: B,
				attachments: B,
				notifications: B,
				approvals: B,
				suggestions: B,
			},
			{ additionalProperties: false },
		),
		limits: Type.Object({ maxSubs: N, attachmentMaxBytes: N, transcriptPage: N }, { additionalProperties: false }),
		auth: Type.Object(
			{ kind: Type.Union([Type.Literal("local"), Type.Literal("remote")]), owner: B },
			{ additionalProperties: false },
		),
	},
	{ additionalProperties: false },
);
export type NodeFacts = Static<typeof NodeFactsSchema>;

export const CapabilitiesGetParamsSchema = Type.Object({}, { additionalProperties: false });
export type CapabilitiesGetParams = Static<typeof CapabilitiesGetParamsSchema>;

export const CapabilitiesGetResultSchema = NodeFactsSchema;
export type CapabilitiesGetResult = Static<typeof CapabilitiesGetResultSchema>;

export const CapabilitiesChangedEvSchema = Type.Object(
	{ reason: Type.Union([Type.Literal("plugin-reload"), Type.Literal("config-reload")]) },
	{ additionalProperties: false },
);
export type CapabilitiesChangedEv = Static<typeof CapabilitiesChangedEvSchema>;

export { type Scope, ScopeSchema } from "./views.js";

export const NodeFactsAddendumSchema = Type.Object(
	{
		minor: N,
		node: Type.Object({ id: T, name: T }, { additionalProperties: false }),
		views: Type.Array(ViewDeclSchema),
		models: Type.Object({ select: B }, { additionalProperties: false }),
		remoteSession: Type.Object(
			{ create: B, modes: Type.Array(T), agents: Type.Array(T), workspaces: B },
			{ additionalProperties: false },
		),
		features: Type.Object(
			{ attachments: B, notifications: B, approvals: B, suggestions: B },
			{ additionalProperties: false },
		),
		limits: Type.Object({ attachmentMaxBytes: N }, { additionalProperties: false }),
		auth: Type.Object(
			{ kind: Type.Union([Type.Literal("local"), Type.Literal("remote")]), owner: B },
			{ additionalProperties: false },
		),
	},
	{ additionalProperties: false },
);
export type NodeFactsAddendum = Static<typeof NodeFactsAddendumSchema>;
