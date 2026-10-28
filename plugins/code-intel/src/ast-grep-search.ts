import type { Tool } from "@yonder/sdk";
import { Type } from "typebox";
import { callLens } from "./lens-mcp.js";

export const astGrepSearch: Tool = {
	name: "code-intel_ast_grep_search",
	description: "Search code by AST structure. Example: console.log($MSG).",
	parameters: Type.Object(
		{
			lang: Type.String(),
			pattern: Type.Optional(Type.String()),
			rule: Type.Optional(Type.String()),
			nodeKind: Type.Optional(Type.String()),
			paths: Type.Optional(Type.Array(Type.String(), { maxItems: 200 })),
			selector: Type.Optional(Type.String()),
			context: Type.Optional(Type.Number()),
			insideKind: Type.Optional(Type.String()),
			hasKind: Type.Optional(Type.String()),
			hasDescendantKind: Type.Optional(Type.String()),
			follows: Type.Optional(Type.String()),
			precedes: Type.Optional(Type.String()),
			skip: Type.Optional(Type.Number()),
			maxMatches: Type.Optional(Type.Number()),
			groupByFile: Type.Optional(Type.Boolean()),
			strictness: Type.Optional(
				Type.Union([
					Type.Literal("smart"),
					Type.Literal("relaxed"),
					Type.Literal("ast"),
					Type.Literal("cst"),
					Type.Literal("signature"),
					Type.Literal("template"),
				]),
			),
			validateOnly: Type.Optional(Type.Boolean()),
			dump: Type.Optional(Type.Boolean()),
		},
		{ additionalProperties: false },
	),
	capabilities: ["read", "exec"],
	async execute(value, ctx) {
		return callLens("pilens_ast_grep_search", value as object, ctx);
	},
};
