import type { SubagentTaskRequest, Tool, ToolContext } from "@yonder/sdk";
import { Type } from "typebox";
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

const Action = Type.Union([Type.Literal("run"), Type.Literal("list"), Type.Literal("status"), Type.Literal("stop")]);

/**
 * Management-action entry for sub-agent dispatch (SA1): `action` plus every other field inside `options`.
 * It delegates to task_run / task_control, so preset, credential slots, the two-level nesting limit
 * and admin checks stay enforced there. The legacy task_run / task_control tools are unchanged.
 */
export function createSubagentTool(runtime: () => Runtime, tools: () => Tool[]): Tool {
	const find = (name: string): Tool => {
		const found = tools().find((tool) => tool.name === name);
		if (!found) throw new Error(`${name} unavailable`);
		return found;
	};
	return {
		name: "subagent",
		description:
			"Manage delegated sub-agents. action=run starts one (options: preset, task, async, sources, effort, credentialSlots, attachments; same rules as task_run). action=list shows this session's background sub-agents. action=status needs options.id. action=stop needs options.id. Put every parameter except action inside options.",
		capabilities: [],
		parameters: Type.Object(
			{ action: Action, options: Type.Optional(Type.Object({}, { additionalProperties: true })) },
			{ additionalProperties: false },
		),
		async execute(value, ctx) {
			const args = value as { action: "run" | "list" | "status" | "stop"; options?: Record<string, unknown> };
			const options = args.options ?? {};
			if (args.action === "run") return find("task_run").execute(options, ctx);
			if (args.action === "list") {
				const rows = await runtime().backgroundList(ctx.session);
				return { text: JSON.stringify(rows.filter((row) => row.name === "task_run")) };
			}
			if (typeof options.id !== "string" || !/^[0-9]+$/.test(options.id))
				throw new Error("options.id (numeric background id) is required");
			if (args.action === "status") return find("task_control").execute({ action: "status", id: options.id }, ctx);
			await runtime().backgroundChild(ctx.session, options.id);
			return {
				text: JSON.stringify(await runtime().backgroundAction(ctx.session, { action: "kill", id: options.id })),
			};
		},
	};
}
