import Type, { type Static } from "typebox";

const T = Type.String();
const B = Type.Boolean();
const O = Type.Optional;
const A = Type.Array;

export const ApprovalCardSchema = Type.Object(
	{
		approvalId: T,
		level: Type.Literal("L2"),
		library: T,
		ref: T,
		field: O(T),
		sink: T,
		reason: O(T),
		session: O(T),
		requestedAt: T,
		expiresAt: T,
		state: Type.Union([
			Type.Literal("pending"),
			Type.Literal("approved"),
			Type.Literal("denied"),
			Type.Literal("timeout"),
		]),
		answeredBy: O(T),
	},
	{ additionalProperties: false },
);
export type ApprovalCard = Static<typeof ApprovalCardSchema>;

export const ApprovalRequestedEvSchema = Type.Object({ card: ApprovalCardSchema }, { additionalProperties: false });
export type ApprovalRequestedEv = Static<typeof ApprovalRequestedEvSchema>;

export const ApprovalAnsweredEvSchema = Type.Object(
	{
		approvalId: T,
		state: Type.Union([Type.Literal("approved"), Type.Literal("denied"), Type.Literal("timeout")]),
		answeredBy: T,
		first: B,
	},
	{ additionalProperties: false },
);
export type ApprovalAnsweredEv = Static<typeof ApprovalAnsweredEvSchema>;

export const ApprovalsListParamsSchema = Type.Object(
	{ state: O(Type.Union([Type.Literal("pending"), Type.Literal("all")])) },
	{ additionalProperties: false },
);
export type ApprovalsListParams = Static<typeof ApprovalsListParamsSchema>;

export const ApprovalsListResultSchema = Type.Object({ items: A(ApprovalCardSchema) }, { additionalProperties: false });
export type ApprovalsListResult = Static<typeof ApprovalsListResultSchema>;

export const ApprovalsAnswerParamsSchema = Type.Object(
	{ approvalId: T, decision: Type.Union([Type.Literal("approve"), Type.Literal("deny")]) },
	{ additionalProperties: false },
);
export type ApprovalsAnswerParams = Static<typeof ApprovalsAnswerParamsSchema>;

export const ApprovalsAnswerResultSchema = Type.Object(
	{ state: Type.Literal("answered"), by: T, first: B },
	{ additionalProperties: false },
);
export type ApprovalsAnswerResult = Static<typeof ApprovalsAnswerResultSchema>;
