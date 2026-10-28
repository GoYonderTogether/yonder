import type { Tool } from "@yonder/sdk";
import { Type } from "typebox";
import { callLens } from "./lens-mcp.js";

export const lspNavigation: Tool = {
	name: "code-intel_lsp_navigation",
	description: 'Navigate code using LSP. Example: {operation: "references", path: "src/app.ts", line: 12}.',
	parameters: Type.Object(
		{
			operation: Type.Union([
				Type.Literal("definition"),
				Type.Literal("typeDefinition"),
				Type.Literal("declaration"),
				Type.Literal("references"),
				Type.Literal("hover"),
				Type.Literal("signatureHelp"),
				Type.Literal("documentSymbol"),
				Type.Literal("findSymbol"),
				Type.Literal("workspaceSymbol"),
				Type.Literal("codeAction"),
				Type.Literal("rename"),
				Type.Literal("rename_file"),
				Type.Literal("implementation"),
				Type.Literal("prepareCallHierarchy"),
				Type.Literal("incomingCalls"),
				Type.Literal("outgoingCalls"),
				Type.Literal("executeCommand"),
				Type.Literal("workspaceDiagnostics"),
				Type.Literal("capabilities"),
			]),
			path: Type.Optional(Type.String()),
			line: Type.Optional(Type.Number()),
			character: Type.Optional(Type.Number()),
			symbol: Type.Optional(Type.String()),
			endLine: Type.Optional(Type.Number()),
			endCharacter: Type.Optional(Type.Number()),
			newName: Type.Optional(Type.String()),
			newFilePath: Type.Optional(Type.String()),
			apply: Type.Optional(Type.Boolean()),
			command: Type.Optional(Type.String()),
			commandArguments: Type.Optional(Type.Array(Type.Unknown())),
			query: Type.Optional(Type.String()),
			kinds: Type.Optional(Type.Array(Type.String())),
			exactMatch: Type.Optional(Type.Boolean()),
			topLevelOnly: Type.Optional(Type.Boolean()),
			maxResults: Type.Optional(Type.Number()),
			callHierarchyItem: Type.Optional(Type.Object({}, { additionalProperties: true })),
		},
		{ additionalProperties: false },
	),
	capabilities: ["read", "write", "exec"],
	async execute(value, ctx) {
		const args = value as { operation: string; apply?: boolean };
		if (args.apply && ["rename", "rename_file", "executeCommand"].includes(args.operation)) {
			return {
				text: "Applying LSP changes is unavailable: the current one-shot MCP connection cannot ensure complete cross-file edits or cancellation. Preview with apply:false.",
				isError: true,
			};
		}
		return callLens("pilens_lsp_navigation", args, ctx);
	},
};
