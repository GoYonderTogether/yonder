import type { Tool } from "@yonder/sdk";
import { Type } from "typebox";
import type { Runtime } from "../runtime/index.js";
import type { Sessions } from "../sessions/index.js";
import type { Store } from "../store/index.js";

export function createTaskControl(options: { runtime: () => Runtime; sessions: Sessions; store: Store }): Tool {
	return {
		name: "task_control",
		description:
			"Inspect a delegated background run, steer it while running, or resume its retained child after completion.",
		capabilities: [],
		parameters: Type.Object(
			{
				action: Type.Union([
					Type.Literal("status"),
					Type.Literal("result"),
					Type.Literal("steer"),
					Type.Literal("resume"),
				]),
				id: Type.String({ pattern: "^[0-9]+$" }),
				message: Type.Optional(Type.String({ minLength: 1 })),
			},
			{ additionalProperties: false },
		),
		async execute(value, ctx) {
			try {
				ctx.signal.throwIfAborted();
				const args = value as { action: "status" | "result" | "steer" | "resume"; id: string; message?: string };
				const runtime = options.runtime();
				const child = await runtime.backgroundChild(ctx.session, args.id);
				const session = await options.store.sessions.get(child.session);
				if (!session || session.parent !== ctx.session) throw new Error("Child task not found in this session");
				if (args.action === "status" || args.action === "result")
					return {
						text: JSON.stringify(await runtime.backgroundAction(ctx.session, { action: "status", id: args.id })),
					};
				if (!args.message) throw new Error("message is required");
				const running = child.state.status !== "terminal" || (await runtime.hasPendingWork(child.session));
				if (args.action === "steer" && !running) throw new Error("Task has completed; use resume");
				if (args.action === "resume" && running) throw new Error("Task is running; use steer");
				if (session.closed) throw new Error("Task was not retained; launch with async=true to enable resume");
				const receipt = await options.sessions.api.submit(
					child.session,
					{ text: args.message },
					{ wait: args.action === "resume", busy: "steer" },
				);
				const resultFile = "text" in receipt ? await ctx.cacheToolOutput?.(receipt.text) : undefined;
				return { text: JSON.stringify({ ...receipt, ...(resultFile ? { resultFile } : {}) }) };
			} catch (error) {
				return { text: error instanceof Error ? error.message : String(error), isError: true };
			}
		},
	};
}
