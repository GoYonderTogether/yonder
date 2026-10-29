import { createWriteStream, mkdtempSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { finished as streamFinished } from "node:stream/promises";
import { setTimeout as sleep } from "node:timers/promises";
import type { Context } from "@earendil-works/chord";
import { BACKGROUND_CONTEXT as C, withAbortSignal } from "@earendil-works/chord/context";
import {
	defineExtension,
	defineTask,
	type Harness,
	type JsonObject,
	type Task,
	type TaskId,
	type TaskOptions,
	type ToolExecutionApi,
	type ToolExecutionResult,
	type ToolRegistration,
	type Tx,
} from "@earendil-works/pi-durable";
import type { SqliteStorage } from "@earendil-works/pi-durable/storage/sqlite";
import type { YEvent } from "@yonder/sdk";
import { Type } from "typebox";
import { clean, failed, type Input, JobDoc, JobPointer, json, outcomeResult, type State } from "./background-docs.js";
import { cid } from "./docs.js";
import { cacheToolOutput } from "./tool-output-cache.js";

const INTERRUPTED_RESULT =
	"Task interrupted by restart; side effects may have occurred. Re-check state, avoid repeating completed actions, and resume.";

type LiveOutput = { output: string; next: number; write?: (text: string, eof?: boolean) => Promise<void> };

/** Native pi tasks own detached calls, their child conversations, cancellation and durable receipts. */
export function createBackground(options: {
	home?: string;
	cacheOutput?(config: string): boolean;
	harness(): Harness;
	config(session: string, context: Context): Promise<string>;
	execute(input: Input, api: ToolExecutionApi, context: Context): Promise<ToolExecutionResult>;
	finished(session: string, id: string, name: string, result: ToolExecutionResult, origin?: YEvent): Promise<void>;
	report(error: unknown): void;
	changed?(session: string): void;
	settled?(session: string): Promise<void>;
}) {
	const harness = options.harness;
	const changed = (session: string) => {
		try {
			options.changed?.(session);
		} catch (error) {
			options.report(error);
		}
	};
	const watchers = new Map<number, { controller: AbortController; done: Promise<void> }>();
	const running = new Map<number, LiveOutput>();
	const task = defineTask<Input, State, ToolExecutionResult>({
		name: "yonder.background",
		version: 1,
		initial: () => ({ phase: "start" }),
		phases: {
			async start(job, runtime, context) {
				const key = String(job.id),
					live: LiveOutput = { output: "", next: 0 };
				running.set(job.id, live);
				let saved = false;
				let outputBytes = 0,
					outputLines = 1;
				let capture: { dir: string; path: string; stream: ReturnType<typeof createWriteStream> } | undefined;
				let captureFailed = false;
				try {
					await runtime.commit(async (tx) => {
						Object.assign(await tx.doc(JobDoc, job.conversationId, key, null), {
							name: job.input.name,
							started: Date.now(),
						});
						return { status: "running", checkpoint: { phase: "interrupted" } };
					}, context);
					const diagnostics: NonNullable<ToolExecutionResult["diagnostics"]>[number][] = [];
					let details: ToolExecutionResult["details"], result: ToolExecutionResult;
					const api: ToolExecutionApi = {
						taskId: job.id,
						conversationId: job.conversationId,
						callId: job.input.callId,
						registry: runtime.registry,
						models: runtime.models,
						env: undefined,
						agent: runtime.agent,
						snapshot: runtime.snapshot,
						snapshotAsOf: runtime.snapshotAsOf,
						watchDoc: runtime.watchDoc,
						memo: runtime.memo,
						getTask: runtime.getTask,
						waitForTask: runtime.waitForTask,
						conversation: runtime.conversation,
						output(chunk) {
							const text = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();
							outputBytes += Buffer.byteLength(text);
							outputLines += (text.match(/\n/g) ?? []).length;
							try {
								if (
									!captureFailed &&
									options.home &&
									options.cacheOutput?.(job.input.config) &&
									job.input.name !== "bash"
								) {
									if (!capture) {
										const dir = mkdtempSync(join(tmpdir(), "yonder-output-"));
										const path = join(dir, "output");
										capture = { dir, path, stream: createWriteStream(path, { mode: 0o600 }) };
										capture.stream.on("error", options.report);
									}
									capture.stream.write(text);
								}
							} catch (error) {
								captureFailed = true;
								options.report(error);
							}
							live.next += text.length;
							live.output = (live.output + text).slice(-65536);
						},
						outputWindow: undefined,
						retainedOutput: () => ({ text: live.output, truncated: live.output.length >= 65536 }),
						diagnostic(diagnostic) {
							diagnostics.push(diagnostic);
						},
						async details(value) {
							details = value;
						},
						async commit<T>(change: (tx: Tx) => T | Promise<T>, ctx: Context): Promise<T> {
							let value!: T;
							await runtime.commit(async (tx) => {
								value = await change(tx);
								return undefined;
							}, ctx);
							return value!;
						},
						async createTask<I, S extends { phase: string }, R, H extends object>(
							child: Task<I, S, R, H>,
							input: I,
							childOptions: Omit<TaskOptions, "conversationId">,
							ctx: Context,
						): Promise<TaskId<R>> {
							let id: TaskId<R> | undefined;
							await runtime.commit(async (tx) => {
								id = await tx.createTask(child, input, { ...childOptions, conversationId: job.conversationId });
								return undefined;
							}, ctx);
							return id!;
						},
						async executeTool() {
							throw new Error("Nested pi tool execution is unavailable from SDK tool jobs");
						},
					};
					try {
						result = await options.execute(job.input, api, context);
						result = clean({
							...result,
							output: result.output ?? [{ type: "text", text: live.output }],
							...(details !== undefined && result.details === undefined ? { details } : {}),
							...(diagnostics.length ? { diagnostics: [...diagnostics, ...(result.diagnostics ?? [])] } : {}),
						});
						if (capture) {
							try {
								capture.stream.end();
								await streamFinished(capture.stream);
								if (!captureFailed && options.home && (outputBytes > 50 * 1024 || outputLines > 2000)) {
									const path = await cacheToolOutput(
										options.home,
										String(job.conversationId),
										job.input.name,
										job.input.args,
										await readFile(capture.path, "utf8"),
									);
									result = {
										...result,
										output: [
											{
												type: "text",
												text: `Full output: ${path}. Use read to paginate or grep to search.`,
											},
											...(result.output ?? []),
										],
									};
								}
							} catch (error) {
								options.report(error);
								result = {
									...result,
									output: [
										{ type: "text", text: "Output cache failed; full output is unavailable." },
										...(result.output ?? []),
									],
								};
							}
						}
						if (captureFailed)
							result = {
								...result,
								output: [
									{ type: "text", text: "Output cache failed; full output is unavailable." },
									...(result.output ?? []),
								],
							};
					} catch (error) {
						if (context.abortSignal?.aborted) throw error;
						result = failed(error);
					}
					await runtime.commit(async (tx) => {
						Object.assign(await tx.doc(JobDoc, job.conversationId, key, null), {
							output: live.output,
							next: live.next,
						});
						return { status: "terminal", outcome: { status: "completed", result } };
					}, context);
					saved = true;
				} finally {
					if (capture) {
						capture.stream.destroy();
						await rm(capture.dir, { recursive: true, force: true }).catch(options.report);
					}
					try {
						// Cancellation ends the invocation context; retain its tail before releasing the live window.
						if (!saved && live.next)
							await harness().commit(async (tx) => {
								Object.assign(await tx.doc(JobDoc, job.conversationId, key, null), {
									output: live.output,
									next: live.next,
								});
							}, C);
					} finally {
						running.delete(job.id);
					}
				}
			},
			async interrupted(job, runtime, context): Promise<void> {
				// Internal waits reacquire their durable identity; external effects cannot be replayed.
				if (["agent_ask", "parent_ask", "task_run", "task_continue"].includes(job.input.name))
					return task.definition.phases.start!(job, runtime, context);
				await runtime.commit(
					() => ({
						status: "terminal",
						outcome: {
							status: "failed",
							error: { message: INTERRUPTED_RESULT },
							result: failed(INTERRUPTED_RESULT),
						},
					}),
					context,
				);
			},
		},
		async abort(_job, runtime, context) {
			await runtime.commit(
				() => ({ status: "terminal", outcome: { status: "aborted", result: failed("Cancelled") } }),
				context,
			);
		},
	});
	const notify = async (session: string, id: TaskId<ToolExecutionResult>) => {
		const record = await harness().getTask(id, C);
		if (!record || record.state.status !== "terminal") return;
		const doc = await harness().snapshot(JobDoc, record.conversationId, String(id), C);
		if (!doc?.detached || doc.notified) return;
		const outcome = record.state.outcome;
		if (outcome.status !== "aborted") {
			const snapshot = JSON.parse((record.input as unknown as Input).config);
			const messages = snapshot.events.filter((event: YEvent) => event.type === "message.in");
			const origin =
				snapshot.events[0]?.type !== "message.in" && messages.length === 1 ? messages[0] : snapshot.events[0];
			await options.finished(session, String(id), doc.name, outcomeResult(outcome), origin);
		}
		await harness().commit(async (tx) => {
			(await tx.doc(JobDoc, record.conversationId, String(id), null)).notified = true;
		}, C);
		await options.settled?.(session);
	};
	const watch = (session: string, id: TaskId<ToolExecutionResult>) => {
		if (watchers.has(id)) return;
		const controller = new AbortController();
		const done = (async () => {
			let delay = 1000;
			while (!controller.signal.aborted) {
				try {
					await harness().waitForTask(id, withAbortSignal(controller.signal, C));
					changed(session);
					await notify(session, id);
					return;
				} catch (error) {
					if (controller.signal.aborted) return;
					options.report(error);
					await sleep(delay, undefined, { signal: controller.signal, ref: false });
					delay = Math.min(delay * 2, 30000);
				}
			}
		})()
			.catch((error) => {
				if (!controller.signal.aborted) options.report(error);
			})
			.finally(() => watchers.delete(id));
		watchers.set(id, { controller, done });
	};
	const run = async (tool: ToolRegistration, args: JsonObject, api: ToolExecutionApi, context: Context) => {
		const config = await options.config(String(api.conversationId), context);
		const id = await api.commit(async (tx) => {
			const pointer = await tx.doc(JobPointer, api.taskId);
			if (!pointer.id)
				pointer.id = await tx.createTask(
					task,
					{ name: tool.name, args, callId: api.callId, config },
					{ ownership: { kind: "conversation" }, background: true, conversationId: api.conversationId },
				);
			return pointer.id as TaskId<ToolExecutionResult>;
		}, context);
		const controller = new AbortController();
		const timer = setTimeout(
			() => controller.abort(),
			(tool.name === "bash" && args.background === true) ||
				(tool.name === "task_run" && args.async === true) ||
				args.executionMode === "background"
				? 0
				: args.executionMode === "wait"
					? 2147483647
					: 15000,
		);
		try {
			const done = await harness().waitForTask(
				id,
				withAbortSignal(AbortSignal.any([controller.signal, context.abortSignal!]), C),
			);
			return outcomeResult(done.state.outcome);
		} catch (error) {
			if (context.abortSignal?.aborted) {
				await harness().abortTask(id, C);
				throw error;
			}
			if (!controller.signal.aborted) throw error;
			await harness().commit(async (tx) => {
				(await tx.doc(JobDoc, api.conversationId, String(id), null)).detached = true;
			}, C);
			changed(String(api.conversationId));
			watch(String(api.conversationId), id);
			const value = json({
				background: String(id),
				tool: tool.name,
				status: "running",
				message:
					"Continue other work; completion is delivered automatically. Use process for status, logs, wait or cancellation.",
			});
			return {
				...value,
				...(tool.structuredOutputSchema ? { structuredOutput: { background: String(id) } } : {}),
				details: { background: String(id) },
			};
		} finally {
			clearTimeout(timer);
		}
	};
	const inspect = async (session: string, id: number) => {
		const record = await harness().getTask(id as TaskId<ToolExecutionResult>, C);
		if (!record || String(record.conversationId) !== session || record.kind !== "yonder.background")
			throw new Error("Background job not found in this session");
		const doc = await harness().snapshot(JobDoc, record.conversationId, String(id), C);
		return { record, doc };
	};
	const action = async (
		session: string,
		args: { action: string; id: string; offset?: number; text?: string; eof?: boolean },
		context: Context,
	) => {
		if (!/^[0-9]+$/.test(args.id) || !Number.isSafeInteger(Number(args.id)))
			throw new Error("Invalid background job id");
		const id = Number(args.id),
			{ record, doc } = await inspect(session, id);
		if (args.action === "kill") await harness().abortTask(id as TaskId, C);
		if (args.action === "write") {
			const write = running.get(id)?.write;
			if (!write) return failed("This job has no writable stdin or has already ended");
			await write(args.text ?? "", args.eof);
		}
		if (args.action === "wait" && record.state.status !== "terminal") {
			const stop = new AbortController(),
				timer = setTimeout(() => stop.abort(), 15000);
			try {
				await harness().waitForTask(
					id as TaskId,
					withAbortSignal(AbortSignal.any([stop.signal, context.abortSignal!]), C),
				);
			} catch (error) {
				if (context.abortSignal?.aborted || !stop.signal.aborted) throw error;
			} finally {
				clearTimeout(timer);
			}
		}
		const current = await inspect(session, id),
			live = running.get(id),
			output = live?.output ?? current.doc?.output ?? "",
			next = live?.next ?? current.doc?.next ?? output.length,
			base = next - output.length,
			offset = Math.max(base, args.offset ?? base);
		return {
			id: args.id,
			name: doc?.name,
			started: doc?.started,
			state: current.record.state,
			output: output.slice(offset - base),
			offset,
			next,
			truncated: (args.offset ?? base) < base,
		};
	};
	return {
		extension: defineExtension({ name: "yonder.background", tasks: [task] }),
		run,
		running,
		async list(session: string, storage: SqliteStorage) {
			const page = await storage.scanTasks(
				{ conversationId: cid(session), kind: "yonder.background" },
				Number.MAX_SAFE_INTEGER,
				undefined,
				C,
			);
			const jobs = await Promise.all(
				page.items.map(async (row) => {
					const { doc } = await inspect(session, row.id);
					return doc?.detached
						? { id: String(row.id), name: doc.name, started: doc.started, state: row.state }
						: undefined;
				}),
			);
			return jobs.filter((job) => job !== undefined);
		},
		async manage(session: string, args: { action: "status" | "log" | "kill"; id: string; offset?: number }) {
			if (!["status", "log", "kill"].includes(args.action)) throw new Error("Invalid background action");
			if (args.offset !== undefined && (!Number.isSafeInteger(args.offset) || args.offset < 0))
				throw new Error("Invalid background log offset");
			return action(session, args, C);
		},
		async pending(id: TaskId) {
			const record = await harness().getTask(id as TaskId<ToolExecutionResult>, C);
			if (!record) return false;
			const doc = await harness().snapshot(JobDoc, record.conversationId, String(id), C);
			return (
				!!doc?.detached &&
				!doc.notified &&
				record.state.status === "terminal" &&
				record.state.outcome.status !== "aborted"
			);
		},
		async close() {
			const current = [...watchers.values()];
			for (const watch of current) watch.controller.abort();
			await Promise.all(current.map((watch) => watch.done));
		},
		async recover(records: readonly { id: number; conversationId: number }[]) {
			for (const row of records) watch(String(row.conversationId), row.id as TaskId<ToolExecutionResult>);
		},
		tool: {
			name: "process",
			description:
				"Manage a background tool or command owned by this session: status, log, wait (up to 15 seconds), write stdin, or kill. Write accepts eof=true to end stdin. Logs use absolute character offset/next cursors; truncated means the requested prefix was discarded. The original tool result remains available after completion. Use the returned background id, not an OS pid or Agent id. Completion is delivered automatically; inspect only for a dependent step or a suspected stall, not in a polling loop. Read state and incremental output before claiming progress or retrying. kill stops the owned operation; it does not undo external effects, and write is stdin, not an instruction message to an Agent.",
			parameters: Type.Object(
				{
					action: Type.Union(["status", "log", "wait", "write", "kill"].map((x) => Type.Literal(x))),
					id: Type.String({ pattern: "^[0-9]+$" }),
					offset: Type.Optional(Type.Integer({ minimum: 0 })),
					text: Type.Optional(Type.String()),
					eof: Type.Optional(Type.Boolean()),
				},
				{ additionalProperties: false },
			),
			deferred: true as const,
			async execute(value: unknown, api: ToolExecutionApi, context: Context) {
				const args = value as { action: string; id: string; offset?: number; text?: string; eof?: boolean };
				const result = await action(String(api.conversationId), args, context);
				return "isError" in result ? result : json(result);
			},
		},
	};
}
