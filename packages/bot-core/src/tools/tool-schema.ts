import { Type } from "typebox";
import { MAX_SOURCES } from "./sources.js";

export const text = () => Type.String({ minLength: 1 });
export const schema = (fields: Record<string, import("typebox").TSchema>) =>
	Type.Object(fields, { additionalProperties: false });
export const effortSchema = Type.Optional(
	Type.String({
		minLength: 1,
		description:
			"Optional per-run thinking override. Requires admin capability; otherwise omit this field and use the configured preset/profile thinking.",
	}),
);
export const sourcesSchema = Type.Optional(
	Type.Array(text(), {
		minItems: 1,
		maxItems: MAX_SOURCES,
		description:
			"Optional exact inbound message IDs to quote from the current source conversation. Omit this field when not quoting or when no source conversation exists. Never send an empty array, prose or invented IDs. It is not required for delegation.",
	}),
);
export const asyncSchema = Type.Optional(
	Type.Boolean({ description: "Return a durable background ID immediately; completion is delivered automatically." }),
);
export const attachmentSchema = Type.Object(
	{
		kind: Type.Union([Type.Literal("image"), Type.Literal("audio"), Type.Literal("video"), Type.Literal("file")]),
		mime: text(),
		uri: text(),
		name: Type.Optional(text()),
		bytes: Type.Optional(Type.Number({ minimum: 0 })),
	},
	{ additionalProperties: false },
);
