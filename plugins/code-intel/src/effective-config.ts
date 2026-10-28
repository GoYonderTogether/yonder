import type { Tool } from "@yonder/sdk";
import { Type } from "typebox";
import { callLens } from "./lens-mcp.js";

export const effectiveConfig: Tool = {
	name: "code-intel_effective_config",
	description: "Explain the resolved language configuration, sources, and tool selection for an optional file.",
	parameters: Type.Object({ file: Type.Optional(Type.String({ minLength: 1 })) }, { additionalProperties: false }),
	capabilities: ["read", "exec"],
	async execute(value, ctx) {
		return callLens("pilens_effective_config", value as { file?: string }, ctx);
	},
};
