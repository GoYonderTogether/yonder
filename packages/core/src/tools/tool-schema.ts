import { Type } from "typebox";

const text = () => Type.String({ minLength: 1 });
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
