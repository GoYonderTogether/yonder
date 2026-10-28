import type { Tool } from "@yonder/sdk";
import { Type } from "typebox";
import { callLens } from "./lens-mcp.js";

export const projectReport: Tool = {
	name: "code-intel_project_report",
	description:
		"Report project structure, hubs, entry points and risks using the pi-lens review graph. A cold cache builds in the background; retry when ready.",
	parameters: Type.Object(
		{
			limit: Type.Optional(Type.Number()),
			focus: Type.Optional(Type.String()),
			view: Type.Optional(Type.Union([Type.Literal("default"), Type.Literal("compact")])),
		},
		{ additionalProperties: false },
	),
	capabilities: ["read", "exec"],
	async execute(value, ctx) {
		return callLens("pilens_project_report", value as object, ctx);
	},
};
