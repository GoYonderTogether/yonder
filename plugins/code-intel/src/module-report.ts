import type { ToolContext } from "@yonder/sdk";
import { callLens } from "./lens-mcp.js";

export function moduleReport(args: object, ctx: ToolContext) {
	return callLens("pilens_module_report", args, ctx);
}
