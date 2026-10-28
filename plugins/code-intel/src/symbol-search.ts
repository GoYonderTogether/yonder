import type { Tool } from "@yonder/sdk";
import { Type } from "typebox";
import { callLens } from "./lens-mcp.js";

export const symbolSearch: Tool = {
	name: "code-intel_symbol_search",
	description:
		"Find files by ranked identifier search. A cold index builds in the background; retry when unavailable. Use grep for text and LSP for exact references.",
	parameters: Type.Object(
		{
			query: Type.String({ minLength: 1 }),
			limit: Type.Optional(Type.Number()),
			paths: Type.Optional(Type.Array(Type.String())),
			lang: Type.Optional(Type.String()),
		},
		{ additionalProperties: false },
	),
	capabilities: ["read", "exec"],
	async execute(value, ctx) {
		return callLens("pilens_symbol_search", value as object, ctx);
	},
};
