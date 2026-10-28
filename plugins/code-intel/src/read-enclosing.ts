import type { Tool } from "@yonder/sdk";
import { Type } from "typebox";
import { callLens } from "./lens-mcp.js";

export const readEnclosing: Tool = {
	name: "code-intel_read_enclosing",
	description: "Read the smallest symbol or callback enclosing a source line using pi-lens.",
	parameters: Type.Object(
		{
			path: Type.String({ minLength: 1 }),
			line: Type.Integer({ minimum: 1 }),
			kinds: Type.Optional(Type.Array(Type.String())),
			maxLines: Type.Optional(Type.Integer({ minimum: 1 })),
			onOversize: Type.Optional(Type.Union([Type.Literal("error"), Type.Literal("slice"), Type.Literal("outline")])),
			aroundLine: Type.Optional(Type.Integer({ minimum: 1 })),
		},
		{ additionalProperties: false },
	),
	capabilities: ["read", "exec"],
	async execute(value, ctx) {
		const { path, ...args } = value as {
			path: string;
			line: number;
			kinds?: string[];
			maxLines?: number;
			onOversize?: string;
			aroundLine?: number;
		};
		return callLens("pilens_read_enclosing", { ...args, file: path }, ctx);
	},
};
