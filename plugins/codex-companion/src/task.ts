import type { Tool, ToolContext } from "@yonder/sdk";
import { Type } from "typebox";
import { run } from "./index.js";

export const taskTool: Tool = {
	name: "codex-companion_task",
	description: "Delegate a read-only task to Codex. Resume uses an external Codex thread ID.",
	parameters: Type.Object(
		{
			codexHome: Type.String({ minLength: 1, description: "Absolute isolated Codex home with an authorized login." }),
			task: Type.String({ minLength: 1 }),
			write: Type.Optional(Type.Boolean()),
			resume: Type.Optional(Type.String({ format: "uuid" })),
			model: Type.Optional(Type.String({ minLength: 1 })),
			effort: Type.Optional(
				Type.Union([
					Type.Literal("none"),
					Type.Literal("minimal"),
					Type.Literal("low"),
					Type.Literal("medium"),
					Type.Literal("high"),
					Type.Literal("xhigh"),
				]),
			),
		},
		{ additionalProperties: false },
	),
	capabilities: ["read", "exec"],
	async execute(value, ctx: ToolContext) {
		const {
			codexHome,
			task,
			write = false,
			resume,
			model,
			effort,
		} = value as { codexHome: string; task: string; write?: boolean; resume?: string; model?: string; effort?: string };
		if (!codexHome?.startsWith("/")) throw new Error("Provide an absolute authorized codexHome.");
		if (!task?.trim()) throw new Error("Provide a task for Codex.");
		if (write)
			throw new Error("Codex write tasks are unavailable until execution-environment path restrictions are enforced.");
		if (resume && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(resume))
			throw new Error("Invalid Codex thread ID.");
		const isolation = await run(ctx, [
			"sh",
			"-c",
			`target=$(cd "$1" && pwd -P) || exit 1
personal=$(cd "$HOME/.codex" 2>/dev/null && pwd -P)
configured=$(test -n "$CODEX_HOME" && cd "$CODEX_HOME" 2>/dev/null && pwd -P)
for forbidden in "$personal" "$configured"; do
 test -z "$forbidden" && continue
 case "$target/" in "$forbidden/"*) exit 1;; esac
done`,
			"sh",
			codexHome,
		]);
		if (isolation.exitCode !== 0)
			throw new Error("codexHome must exist and must not be the default personal Codex home.");
		const path = await run(ctx, ["printenv", "PATH"]);
		if (path.exitCode !== 0) throw new Error("Execution environment PATH is unavailable.");
		const args = [
			"codex",
			"exec",
			"--json",
			"-s",
			"read-only",
			"-c",
			'approval_policy="never"',
			...(model ? ["-m", model === "spark" ? "gpt-5.3-codex-spark" : model] : []),
			...(effort ? ["-c", `model_reasoning_effort=${JSON.stringify(effort)}`] : []),
			...(resume ? ["resume", resume] : []),
			task,
		];
		const result = await run(ctx, args, { CODEX_HOME: codexHome, HOME: codexHome, PATH: path.stdout.trim() });
		if (result.exitCode !== 0)
			throw new Error(
				"Codex task failed; log in with `CODEX_HOME=<authorized-directory> codex login` in the execution environment and check the CLI configuration.",
			);
		let thread = "";
		let output = "";
		for (const line of result.stdout.split("\n")) {
			if (!line.trim()) continue;
			const event = JSON.parse(line);
			if (event.type === "thread.started") thread = event.thread_id;
			if (event.type === "item.completed" && event.item?.type === "agent_message") output = event.item.text;
		}
		if (!output) throw new Error("Codex returned no final message.");
		const ref = thread ? `\n[Codex thread: ${thread}]` : "";
		if (Buffer.byteLength(output) <= 30_000) return { text: output + ref };
		const cached = await ctx.cacheToolOutput?.(output);
		return {
			text: `${output.slice(0, 30_000)}\n[Output truncated; ${cached ? `full output: ${cached}` : "cache unavailable"}]${ref}`,
		};
	},
};
