import Type, { type Static } from "typebox";

const T = Type.String();
const N = Type.Number();
const O = Type.Optional;
const A = Type.Array;

export const AttachmentRefSchema = Type.Object(
	{ uri: T, bytes: N, mime: T, name: O(T) },
	{ additionalProperties: false },
);
export type AttachmentRef = Static<typeof AttachmentRefSchema>;

export const AttachmentRowSchema = Type.Object(
	{
		id: T,
		uri: T,
		name: O(T),
		mime: T,
		bytes: O(N),
		at: T,
		from: O(Type.Union([Type.Literal("user"), Type.Literal("agent")])),
	},
	{ additionalProperties: false },
);
export type AttachmentRow = Static<typeof AttachmentRowSchema>;

/** HTTP headers; the request body is raw bytes, not a JSON RPC object. */
export const AttachmentsPutParamsSchema = Type.Object(
	{ "Content-Type": T, "X-Name": O(T), "X-Session": O(T) },
	{ additionalProperties: false },
);
export type AttachmentsPutParams = Static<typeof AttachmentsPutParamsSchema>;

export const AttachmentsPutResultSchema = AttachmentRefSchema;
export type AttachmentsPutResult = Static<typeof AttachmentsPutResultSchema>;

export const AttachmentsViewPayloadSchema = Type.Object(
	{ items: A(AttachmentRowSchema) },
	{ additionalProperties: false },
);
export type AttachmentsViewPayload = Static<typeof AttachmentsViewPayloadSchema>;
