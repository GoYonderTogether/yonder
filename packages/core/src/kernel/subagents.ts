import type { SubagentTaskRequest, Tool, ToolContext } from "@yonder/sdk";
import { Errors } from "typebox/value";
import type { Runtime } from "../runtime/index.js";

export async function runSubagent(runtime: Runtime, tools: Tool[], request: SubagentTaskRequest, ctx: ToolContext) {
	runtime.assertToolContext(ctx);
	const task = tools.find((tool) => tool.name === "task_run");
	if (!task) throw new Error("task_run unavailable");
	const errors = [...Errors(task.parameters, request)];
	if (errors.length) throw new Error(`Invalid subagent request: ${errors[0]?.message}`);
	return task.execute(request, ctx);
}
