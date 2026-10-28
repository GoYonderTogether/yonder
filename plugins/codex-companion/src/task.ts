import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Tool, ToolContext } from "@yonder/sdk";
import { Type } from "typebox";
import { run } from "./index.js";

const pathFor = (data: string, session: string) =>
	join(data, `${createHash("sha256").update(session).digest("hex")}.json`);

export const candidateTool = (data: string): Tool => ({
	name: "codex-companion_candidates",
	description: "List Codex threads started by this Yonder session for a rescue continuation.",
	parameters: Type.Object({}, { additionalProperties: false }),
	capabilities: ["read"],
	async execute(_value, ctx) {
		try {
			return { text: await readFile(pathFor(data, ctx.session), "utf8") };
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return { text: "[]" };
			throw error;
		}
	},
});

export const taskTool = (data: string, writeEnabled: boolean): Tool => ({
	name: "codex-companion_task",
	description:
		"Delegate a task to Codex; writing requires opt-in and write capability. Resume uses an external Codex thread ID.",
	parameters: Type.Object(
		{
			codexHome: Type.String({ minLength: 1, description: "Absolute Codex home with an authorized login." }),
			task: Type.String({ minLength: 1 }),
			executionMode: Type.Optional(Type.Union([Type.Literal("wait"), Type.Literal("background")])),
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
		if (write && (!writeEnabled || !ctx.capabilities.includes("write")))
			throw new Error("Codex write tasks require writeEnabled and the write capability.");
		if (resume && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(resume))
			throw new Error("Invalid Codex thread ID.");
		const home = await run(ctx, ["test", "-d", codexHome]);
		if (home.exitCode !== 0) throw new Error("codexHome must exist.");
		const path = await run(ctx, ["printenv", "PATH"]);
		if (path.exitCode !== 0) throw new Error("Execution environment PATH is unavailable.");
		const args = [
			"codex",
			"exec",
			"--json",
			"-s",
			write ? "workspace-write" : "read-only",
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
		if (thread) {
			await mkdir(data, { recursive: true });
			const file = pathFor(data, ctx.session);
			let previous: Array<{ id: string; task: string; cwd: string }> = [];
			try {
				previous = JSON.parse(await readFile(file, "utf8"));
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			}
			await writeFile(
				file,
				JSON.stringify(
					[{ id: thread, task, cwd: ctx.env.cwd }, ...previous.filter((item) => item.id !== thread)].slice(0, 20),
				),
			);
		}
		const ref = thread ? `\n[Codex thread: ${thread}]` : "";
		if (Buffer.byteLength(output) <= 30_000) return { text: output + ref };
		const cached = await ctx.cacheToolOutput?.(output);
		return {
			text: `${output.slice(0, 30_000)}\n[Output truncated; ${cached ? `full output: ${cached}` : "cache unavailable"}]${ref}`,
		};
	},
});
