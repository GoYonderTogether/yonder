import { randomUUID } from "node:crypto";
import { definePlugin, type PluginAPI, type ToolContext, type YEvent } from "@yonder/sdk";
import { Type } from "typebox";
import { Ledger } from "./ledger.js";

const taskSchema = Type.Object({ label: Type.String({ minLength: 1, maxLength: 120 }) });

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
					if (event.type === "session.open" && data.mode === "task" && event.parent) {
						for (const task of await ledger.list()) {
							if (task.sourceRun === event.parent && !task.executorSession) {
								const session = String(data.session);
								await ledger.bindExecutor(task.id, session);
								await ledger.event({ id: event.id, task: task.id, type: "executor.active", at: Date.parse(event.ts) });
							}
						}
						return;
					}
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
			name: "progress_task_register",
			description:
				"Register a work item from this real tool invocation; owner/session identity is taken only from ToolContext. Does not assert that a task_run has started or completed.",
			parameters: taskSchema,
			capabilities: ["write"],
			async execute(args: unknown, ctx: ToolContext) {
				await ready;
				const { label } = args as { label: string };
				const id = randomUUID();
				const sourceRun = ctx.events?.findLast((event) => event.type === "session.input")?.id;
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
