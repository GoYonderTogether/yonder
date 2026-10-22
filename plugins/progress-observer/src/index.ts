import { randomUUID } from "node:crypto";
import { definePlugin, type PluginAPI, type ToolContext, type YEvent } from "@yonder/sdk";
import { Type } from "typebox";
import { Ledger } from "./ledger.js";

// Labels are display-only data. Reject unknown fields instead of letting callers
// smuggle instructions or unreviewed association claims through this tool.
const taskSchema = Type.Object(
	{ label: Type.String({ minLength: 1, maxLength: 120 }) },
	{ additionalProperties: false },
);

export default definePlugin({
	setup(api: PluginAPI) {
		const ledger = new Ledger(api.paths.data);
		const ready: Promise<unknown> = ledger.open();
		let queue = Promise.resolve();
		const enqueue = (event: YEvent) => {
			queue = queue
				.then(async () => {
					await ready;
					const data = event.data as Record<string, unknown>;
					// A task.linked fact is durable correlation, but not evidence that its
					// child initialized or began executing.
					if (event.type === "task.linked") return;
					if (event.type !== "session.input" && event.type !== "run.end") return;
					const session = typeof data.session === "string" ? data.session : undefined;
					if (!session) return;
					for (const task of await ledger.list()) {
						if (task.executorSession !== session) continue;
						if (event.type === "session.input") {
							await ledger.event({ id: event.id, task: task.id, type: "executor.active", at: Date.parse(event.ts) });
						} else {
							// A durable run.end is a runtime fact, not acceptance/completion evidence.
							await ledger.event({
								id: event.id,
								task: task.id,
								type: "run.end",
								at: Date.parse(event.ts),
								value: String(data.status ?? "unknown"),
							});
						}
					}
				})
				.catch((error) => api.log.error("Failed to observe task event", { error: String(error) }));
			return queue;
		};
		api.events.on("*", enqueue);
		api.tools.register({
			name: "progress_task_bind",
			description:
				"Bind a registered task only to a task session whose open and input events prove this invocation spawned it.",
			parameters: Type.Object(
				{ taskId: Type.String({ minLength: 1 }), executorSession: Type.String({ minLength: 1 }) },
				{ additionalProperties: false },
			),
			capabilities: ["write"],
			async execute(args: unknown, ctx: ToolContext) {
				await ready;
				const { taskId, executorSession } = args as { taskId: string; executorSession: string };
				const task = (await ledger.list()).find((item) => item.id === taskId);
				if (!task || task.owner !== ctx.agent || task.sourceSession !== ctx.session)
					throw new Error("task does not belong to this invocation");
				if (!task.sourceRun) throw new Error("task has no verifiable source invocation");
				const session = await api.sessions.get(executorSession);
				if (!session || session.mode !== "task" || session.parent !== task.sourceSession)
					throw new Error("executor session lineage mismatch");
				let after: string | undefined;
				let proven = false;
				do {
					const page = await api.events.query({ type: "task.linked", limit: 500, ...(after ? { after } : {}) });
					if (
						page.events.some((event) => {
							const link = event.data as { parentSession?: string; childSession?: string; sourceEvent?: string };
							return (
								event.from === "system:runtime" &&
								link.parentSession === ctx.session &&
								link.childSession === executorSession &&
								link.sourceEvent === task.sourceRun
							);
						})
					)
						proven = true;
					after = page.next;
				} while (!proven && after);
				if (!proven) throw new Error("no runtime task.linked evidence for this invocation");
				const all = await ledger.list();
				if (all.some((item) => item.id !== taskId && item.executorSession === executorSession))
					throw new Error("executor session already bound to another task");
				await ledger.bindExecutor(taskId, executorSession);
				return { text: `Bound ${taskId} to verified executor session.` };
			},
		});
		api.tools.register({
			name: "progress_task_register",
			description:
				"Register a work item from this real tool invocation; owner/session identity is taken only from ToolContext. Does not assert that a task_run has started or completed.",
			parameters: taskSchema,
			capabilities: ["write"],
			async execute(args: unknown, ctx: ToolContext) {
				await ready;
				const { label } = args as { label: string };
				const id = randomUUID();
				const sourceRun =
					ctx.event?.type === "session.input" || ctx.event?.type === "message.in"
						? ctx.event.id
						: ctx.events?.findLast((event) => event.type === "session.input" || event.type === "message.in")?.id;
				await ledger.create(id, label, {
					owner: ctx.agent,
					sourceSession: ctx.session,
					...(sourceRun ? { sourceRun } : {}),
				});
				return { text: `Registered ${id}. No executor session/run has been verified; registration is not completion.` };
			},
		});
		api.triggers.register({
			id: "progress-observer-reconcile",
			async start() {
				await ready;
				await queue;
				let after: string | undefined;
				do {
					const page = await api.events.query({ limit: 500, ...(after ? { after } : {}) });
					for (const event of page.events) await enqueue(event);
					await queue;
					after = page.next;
				} while (after);
			},
			async stop() {
				await queue;
			},
		});
	},
});
