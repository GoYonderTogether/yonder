import Type, { type Static } from "typebox";
import { ModelStatusSchema } from "./model.js";
import { ContextSnapshotSchema, UsageSnapshotSchema, UsageTotalsSchema } from "./usage.js";

const T = Type.String();
const N = Type.Number();
const B = Type.Boolean();
const O = Type.Optional;
const A = Type.Array;

export const ModeSchema = Type.String();
export type Mode = Static<typeof ModeSchema>;

export const OkSchema = Type.Object({ ok: Type.Literal(true) }, { additionalProperties: false });
export type Ok = Static<typeof OkSchema>;

export const AttachmentSchema = Type.Object(
	{
		kind: Type.Union([Type.Literal("image"), Type.Literal("audio"), Type.Literal("video"), Type.Literal("file")]),
		mime: Type.String(),
		uri: Type.String(),
		name: O(T),
		bytes: O(N),
	},
	{ additionalProperties: false },
);
export type Attachment = Static<typeof AttachmentSchema>;

export const SessionInfoSchema = Type.Object(
	{
		id: T,
		agent: Type.Union([T, Type.Null()]),
		profile: T,
		mode: ModeSchema,
		key: T,
		version: T,
		opened: T,
		closed: O(T),
		parent: O(T),
		close: O(Type.Union([Type.Literal("manual"), Type.Literal("run-end")])),
	},
	{ additionalProperties: false },
);
export type SessionInfo = Static<typeof SessionInfoSchema>;

export const TranscriptItemSchema = Type.Object(
	{
		from: O(T),
		id: N,
		kind: T,
		text: T,
		tools: O(A(Type.Object({ name: T, args: Type.Object({}) }, { additionalProperties: false }))),
		event: O(T),
	},
	{ additionalProperties: false },
);
export type TranscriptItem = Static<typeof TranscriptItemSchema>;

export const InputReceiptSchema = Type.Object({ event: T, session: T, deduped: O(B) }, { additionalProperties: false });
export type InputReceipt = Static<typeof InputReceiptSchema>;

export const SessionNotificationSchema = Type.Object(
	{ id: N, from: T, event: T, text: T },
	{ additionalProperties: false },
);
export type SessionNotification = Static<typeof SessionNotificationSchema>;

// terminal.info remains the existing kernel shape; runtime-owned details are opaque JSON.
export const TerminalInfoSchema = Type.Object({
	session: SessionInfoSchema,
	agentName: O(T),
	agentWork: O(T),
	config: Type.Object({}),
	model: O(Type.Object({ id: T, provider: T, contextWindow: N, reasoning: B }, { additionalProperties: false })),
	state: O(Type.Object({})),
	usage: Type.Object({}),
	skills: Type.Object({}),
});
export type TerminalInfo = Static<typeof TerminalInfoSchema>;

export const SessionSnapshotSchema = Type.Object(
	{
		session: SessionInfoSchema,
		info: TerminalInfoSchema,
		config: Type.Optional(
			Type.Object(
				{ resolved: Type.Optional(Type.Record(Type.String(), Type.Unknown())) },
				{ additionalProperties: true },
			),
		),
		transcript: O(Type.Object({ items: A(TranscriptItemSchema), hasMore: B }, { additionalProperties: false })),
		model: O(ModelStatusSchema),
		usage: O(UsageSnapshotSchema),
		context: O(ContextSnapshotSchema),
	},
	{ additionalProperties: false },
);
export type SessionSnapshot = Static<typeof SessionSnapshotSchema>;

export const SessionUpdateSchema = Type.Union([
	Type.Object(
		{
			type: Type.Union([
				Type.Literal("snapshot"),
				Type.Literal("message"),
				Type.Literal("tool"),
				Type.Literal("state"),
				Type.Literal("error"),
				Type.Literal("end"),
				Type.Literal("inbox"),
				Type.Literal("notification"),
				Type.Literal("model.fallback"),
				Type.Literal("todo.updated"),
			]),
			session: O(T),
			runId: O(T),
			eventIds: O(A(T)),
			event: O(Type.Object({})),
			id: O(T),
			message: O(Type.Object({})),
			messages: O(A(Type.Object({ id: T, message: Type.Object({}) }, { additionalProperties: false }))),
			items: O(
				A(
					Type.Object(
						{ id: T, message: O(Type.Object({})), notification: O(SessionNotificationSchema) },
						{ additionalProperties: false },
					),
				),
			),
			notification: O(SessionNotificationSchema),
			streaming: O(B),
			running: O(B),
			inputs: O(A(T)),
			inbox: O(A(Type.Object({ id: T, mode: T }, { additionalProperties: false }))),
			tool: O(
				Type.Object(
					{
						id: T,
						name: T,
						args: O(Type.Object({})),
						phase: Type.Union([Type.Literal("start"), Type.Literal("update"), Type.Literal("end")]),
						text: O(T),
						result: O(Type.Object({})),
					},
					{ additionalProperties: false },
				),
			),
			error: O(T),
		},
		{ additionalProperties: false },
	),
	Type.Object(
		{
			type: Type.Literal("event"),
			name: T,
			data: Type.Unknown(),
			session: O(T),
			runId: O(T),
			eventIds: O(A(T)),
			event: O(Type.Object({})),
			id: O(T),
			message: O(Type.Object({})),
			messages: O(A(Type.Object({ id: T, message: Type.Object({}) }, { additionalProperties: false }))),
			items: O(
				A(
					Type.Object(
						{ id: T, message: O(Type.Object({})), notification: O(SessionNotificationSchema) },
						{ additionalProperties: false },
					),
				),
			),
			notification: O(SessionNotificationSchema),
			streaming: O(B),
			running: O(B),
			inputs: O(A(T)),
			inbox: O(A(Type.Object({ id: T, mode: T }, { additionalProperties: false }))),
			tool: O(
				Type.Object(
					{
						id: T,
						name: T,
						args: O(Type.Object({})),
						phase: Type.Union([Type.Literal("start"), Type.Literal("update"), Type.Literal("end")]),
						text: O(T),
						result: O(Type.Object({})),
					},
					{ additionalProperties: false },
				),
			),
			error: O(T),
		},
		{ additionalProperties: false },
	),
]);
export type SessionUpdate = Static<typeof SessionUpdateSchema>;

export const SessionsListParamsSchema = Type.Object(
	{ filter: O(Type.Object({ agent: O(T), mode: O(ModeSchema), open: O(B) }, { additionalProperties: false })) },
	{ additionalProperties: false },
);
export type SessionsListParams = Static<typeof SessionsListParamsSchema>;

export const SessionsListResultSchema = A(SessionInfoSchema);
export type SessionsListResult = Static<typeof SessionsListResultSchema>;

export const SessionsShowParamsSchema = Type.Object(
	{ id: T, limit: O(Type.Integer({ minimum: 1 })), before: O(T), full: O(B) },
	{ additionalProperties: false },
);
export type SessionsShowParams = Static<typeof SessionsShowParamsSchema>;

export const SessionsShowResultSchema = Type.Object(
	{ session: SessionInfoSchema, items: A(TranscriptItemSchema), nextBefore: O(T) },
	{ additionalProperties: false },
);
export type SessionsShowResult = Static<typeof SessionsShowResultSchema>;

export const SessionsTranscriptParamsSchema = Type.Object(
	{ id: T, before: O(N), limit: O(Type.Integer({ minimum: 1, maximum: 500 })) },
	{ additionalProperties: false },
);
export type SessionsTranscriptParams = Static<typeof SessionsTranscriptParamsSchema>;

export const SessionsTranscriptResultSchema = Type.Object(
	{ items: A(TranscriptItemSchema), hasMore: B },
	{ additionalProperties: false },
);
export type SessionsTranscriptResult = Static<typeof SessionsTranscriptResultSchema>;

export const SessionsWatchParamsSchema = Type.Object({ id: T }, { additionalProperties: false });
export type SessionsWatchParams = Static<typeof SessionsWatchParamsSchema>;

export const SessionsWatchResultSchema = SessionSnapshotSchema;
export type SessionsWatchResult = Static<typeof SessionsWatchResultSchema>;

export const SessionsSubmitParamsSchema = Type.Object(
	{
		id: T,
		requestId: O(T),
		text: T,
		attachments: O(A(AttachmentSchema)),
		busy: O(Type.Union([Type.Literal("followup"), Type.Literal("steer"), Type.Literal("interrupt")])),
	},
	{ additionalProperties: false },
);
export type SessionsSubmitParams = Static<typeof SessionsSubmitParamsSchema>;

export const SessionsSubmitResultSchema = InputReceiptSchema;
export type SessionsSubmitResult = Static<typeof SessionsSubmitResultSchema>;

export const SessionsAbortParamsSchema = Type.Object({ id: T }, { additionalProperties: false });
export type SessionsAbortParams = Static<typeof SessionsAbortParamsSchema>;

export const SessionsAbortResultSchema = OkSchema;
export type SessionsAbortResult = Static<typeof SessionsAbortResultSchema>;

export const SessionsCloseParamsSchema = Type.Object({ id: T }, { additionalProperties: false });
export type SessionsCloseParams = Static<typeof SessionsCloseParamsSchema>;

export const SessionsCloseResultSchema = OkSchema;
export type SessionsCloseResult = Static<typeof SessionsCloseResultSchema>;

export const SessionsCommandParamsSchema = Type.Object({ id: T, command: T }, { additionalProperties: false });
export type SessionsCommandParams = Static<typeof SessionsCommandParamsSchema>;

export const SessionsCommandResultSchema = T;
export type SessionsCommandResult = Static<typeof SessionsCommandResultSchema>;

export const SessionsNotifyParamsSchema = Type.Object({ id: T, event: T, text: T }, { additionalProperties: false });
export type SessionsNotifyParams = Static<typeof SessionsNotifyParamsSchema>;

export const SessionsNotifyResultSchema = Type.Object(
	{ session: T, event: T, entry: N, recorded: Type.Literal(true) },
	{ additionalProperties: false },
);
export type SessionsNotifyResult = Static<typeof SessionsNotifyResultSchema>;

export const SessionsRenameParamsSchema = Type.Object(
	{ id: T, title: Type.String({ minLength: 1, maxLength: 80 }) },
	{ additionalProperties: false },
);
export type SessionsRenameParams = Static<typeof SessionsRenameParamsSchema>;

export const SessionsRenameResultSchema = OkSchema;
export type SessionsRenameResult = Static<typeof SessionsRenameResultSchema>;

export const SessionsSearchParamsSchema = Type.Object(
	{ query: T, mode: O(ModeSchema), limit: O(Type.Integer({ minimum: 1, maximum: 100, default: 20 })) },
	{ additionalProperties: false },
);
export type SessionsSearchParams = Static<typeof SessionsSearchParamsSchema>;

export const SessionsSearchResultSchema = Type.Object(
	{
		items: A(Type.Object({ session: SessionInfoSchema, title: O(T), snippet: O(T) }, { additionalProperties: false })),
	},
	{ additionalProperties: false },
);
export type SessionsSearchResult = Static<typeof SessionsSearchResultSchema>;

export const SessionLifecycleEvSchema = Type.Object(
	{ session: T, mode: ModeSchema, profile: T, reason: O(T) },
	{ additionalProperties: false },
);
export type SessionLifecycleEv = Static<typeof SessionLifecycleEvSchema>;

export const RunEndedEvSchema = Type.Object(
	{
		session: T,
		runId: O(T),
		status: Type.Union([Type.Literal("done"), Type.Literal("error"), Type.Literal("aborted"), Type.Literal("limit")]),
		model: T,
		thinking: O(T),
		usage: UsageTotalsSchema,
	},
	{ additionalProperties: false },
);
export type RunEndedEv = Static<typeof RunEndedEvSchema>;

export const SessionUpdateEvSchema = Type.Object(
	{ type: Type.Literal("session.update"), data: SessionUpdateSchema },
	{ additionalProperties: false },
);
export type SessionUpdateEv = Static<typeof SessionUpdateEvSchema>;
