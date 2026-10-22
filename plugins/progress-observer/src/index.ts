import { randomUUID } from "node:crypto";
import { definePlugin, type PluginAPI, parseRef, type ToolContext, type YEvent } from "@yonder/sdk";
import { Type } from "typebox";
import { createBoundedDecider } from "./bounded-adapter.js";
import { runDecision } from "./decision-engine.js";
import { Ledger, safeFallback } from "./ledger.js";
import { sendProgress } from "./sender.js";

// Labels are display-only data. Reject unknown fields instead of letting callers
// smuggle instructions or unreviewed association claims through this tool.
const taskSchema = Type.Object(
	{ label: Type.String({ minLength: 1, maxLength: 120 }) },
	{ additionalProperties: false },
);

export default definePlugin({
	configSchema: Type.Object({
		enabled: Type.Optional(Type.Boolean({ default: false })),
		intervalMs: Type.Optional(Type.Integer({ minimum: 1000, default: 20 * 60 * 1000 })),
		stallAfterMs: Type.Optional(Type.Integer({ minimum: 1000, default: 40 * 60 * 1000 })),
		minTasks: Type.Optional(Type.Integer({ minimum: 1, default: 4 })),
		model: Type.Optional(
			Type.Object({ provider: Type.String({ minLength: 1 }), modelId: Type.String({ minLength: 1 }) }),
		),
		// External progress delivery is opt-in per exact source conversation and agent.
		allowedSourceConversations: Type.Optional(
			Type.Array(Type.String({ pattern: "^(conv|acct):\\S+$" }), { default: [] }),
		),
		allowedAgents: Type.Optional(Type.Array(Type.String({ pattern: "^agent:\\S+$" }), { default: [] })),
	}),
	setup(api: PluginAPI) {
		const config = (api.config && typeof api.config === "object" ? api.config : {}) as {
			enabled?: boolean;
			intervalMs?: number;
			stallAfterMs?: number;
			minTasks?: number;
			model?: { provider: string; modelId: string };
			allowedSourceConversations?: string[];
			allowedAgents?: string[];
		};
		const enabled = config.enabled === true;
		const intervalMs =
			Number.isInteger(config.intervalMs) && (config.intervalMs ?? 0) >= 1000
				? (config.intervalMs ?? 20 * 60 * 1000)
				: 20 * 60 * 1000;
		const stallAfterMs =
			Number.isInteger(config.stallAfterMs) && (config.stallAfterMs ?? 0) >= 1000
				? (config.stallAfterMs ?? 40 * 60 * 1000)
				: 40 * 60 * 1000;
		const minTasks = Number.isInteger(config.minTasks) && (config.minTasks ?? 0) >= 1 ? (config.minTasks ?? 4) : 4;
		const allowedSourceConversations = new Set(config.allowedSourceConversations ?? []);
		const allowedAgents = new Set(config.allowedAgents ?? []);
		let stopTimer = () => {};
		let ticking: Promise<void> = Promise.resolve();
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
			name: "progress-observer_task_bind",
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
			name: "progress-observer_task_register",
			description:
				"Register a work item from this real tool invocation; owner/session identity is taken only from ToolContext. Does not assert that a task_run has started or completed.",
			parameters: taskSchema,
			capabilities: ["write"],
			async execute(args: unknown, ctx: ToolContext) {
				await ready;
				const { label } = args as { label: string };
				const id = randomUUID();
				// Bind only the actual message.in context event. Historical events and caller-supplied args
				// are not a reliable current recipient authorization source.
				const source = ctx.event?.type === "message.in" ? ctx.event : undefined;
				const sourceRun = source?.id;
				let target: string | undefined;
				if (source?.conv) {
					try {
						const ref = parseRef(source.conv);
						if (ref.kind === "conv" || ref.kind === "acct") target = source.conv;
					} catch {
						// Invalid event metadata is not a delivery target.
					}
				}
				await ledger.create(id, label, {
					owner: ctx.agent,
					sourceSession: ctx.session,
					...(sourceRun ? { sourceRun } : {}),
					...(target ? { target } : {}),
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
				if (enabled) {
					const tick = async () => {
						try {
							await ready;
							const tasks = await ledger.list();
							// minTasks applies only to unresolved work, never an accumulation of historical done tasks.
							const requiredTasks = tasks.filter((task) => task.executor !== "done" || task.accepted !== "accepted");
							if (requiredTasks.length < minTasks) return;
							const now = Date.now();
							for (const task of requiredTasks) {
								// A recorded active run means progress is unknown, never proof of interruption.
								if (task.executorSession && task.executor !== "active" && task.executor !== "done") {
									const evidenceAt = Math.max(task.lastExecutorEventAt ?? 0, task.lastMilestoneAt ?? 0);
									if (evidenceAt > 0 && now - evidenceAt >= stallAfterMs) {
										const window = `${task.lastExecutorEventAt ?? 0}:${task.lastMilestoneAt ?? 0}`;
										await ledger.event({
											id: `stall:${task.id}:${window}`,
											task: task.id,
											type: "stall.candidate",
											at: now,
										});
									}
								}
								// Require admin-approved source AND agent before model invocation or delivery.
								// The immutable configured set, never model arguments/history, defines scope.
								if (
									!task.target ||
									!allowedSourceConversations.has(task.target) ||
									task.owner == null ||
									!allowedAgents.has(task.owner)
								)
									continue;
								await runDecision(
									{
										ledger,
										decide: config.model
											? createBoundedDecider(api.models, config.model)
											: async (snapshot) => safeFallback(snapshot),
										send: (target, text) => sendProgress(api.messages, target, text),
										boundTarget: task.target,
										minimumIntervalMs: intervalMs,
									},
									task.id,
								);
							}
						} catch (error) {
							api.log.error("Progress observer tick failed", { error: String(error) });
						}
					};
					const timer = setInterval(() => {
						ticking = ticking.then(tick);
					}, intervalMs);
					// Store cleanup on the trigger instance closure, including in fake SDK tests.
					stopTimer = () => clearInterval(timer);
				}
			},
			async stop() {
				stopTimer();
				await Promise.all([queue, ticking]);
				await ready.catch(() => {});
				await ledger.close();
			},
		});
	},
});
