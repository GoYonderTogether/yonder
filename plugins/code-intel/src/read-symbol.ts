import type { Tool } from "@yonder/sdk";
import { Type } from "typebox";
import { callLens } from "./lens-mcp.js";

export const readSymbol: Tool = {
	name: "code-intel_read_symbol",
	description: "Read a symbol or module_report callback handle's verbatim source using pi-lens.",
	parameters: Type.Object(
		{
			path: Type.Optional(
				Type.String({ minLength: 1, description: "Absolute or workspace-relative path to the source file." }),
			),
			file: Type.Optional(Type.String({ minLength: 1 })),
			symbol: Type.String({ minLength: 1 }),
			kind: Type.Optional(Type.String({ minLength: 1 })),
		},
		{ additionalProperties: false },
	),
	capabilities: ["read", "exec"],
	async execute(value, ctx) {
		const { path, file, ...rest } = value as { path?: string; file?: string; symbol: string; kind?: string };
		const target = path ?? file;
		if (!target) return { text: "read_symbol requires path.", isError: true };
		const result = await callLens("pilens_read_symbol", { ...rest, file: target }, ctx);
		if (/\(\d+ matches — returned the /.test(result.text)) {
			return {
				text: `${result.text}\nMultiple definitions: use module_report and a dotted Class.member name or kind to disambiguate.`,
				isError: true,
			};
		}
		return result;
	},
};
