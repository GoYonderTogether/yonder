import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT as C } from "@earendil-works/chord/context";
import {
	defineExtension,
	defineTask,
	type Harness,
	type JsonObject,
	type TaskId,
	type ToolExecutionApi,
	type ToolExecutionResult,
	type ToolRegistration,
} from "@earendil-works/pi-durable";
import type { YEvent } from "@yonder/sdk";
import { expect, test } from "vitest";
import { resolveProfile } from "../config/test-support.js";
import { newEvent } from "../store/index.js";
import type { createBackground } from "./background.js";
import { openDatabase } from "./db.js";
import { Runtime } from "./index.js";
import type { RuntimeSessionConfig } from "./types.js";

// Native task driver replaces only model selection of tool name/arguments. The
// real Yonder wrapper, pi task scheduler, SQLite, env and process tool all run.
test.each(["scope", "full"])(
	"native background %s",
	async (scenario) => {
		const home = await mkdtemp(join(tmpdir(), "yonder-background-"));
		const reports: unknown[] = [];
		let failedAdmission = false;
		const notifications: Array<{ session: string; id: string }> = [];
		const changes: string[] = [];
		let idle = 0;
		let runtime: Runtime | undefined;
		try {
			runtime = await Runtime.open({
				home,
				db: await openDatabase(join(home, "state.db")),
				config: { schema: 1 },
				resolveSession: async () => ({
					agent: null,
					profile: "default",
					cwd: home,
					resolved: resolveProfile({ level: "bypass" }),
				}),
				onReport: (error) => reports.push(error),
				onBackgroundChanged: (session) => changes.push(session),
				onIdle: async () => {
					idle++;
				},
				onBackground: async (session, value) => {
					if (!failedAdmission) {
						failedAdmission = true;
						throw new Error("acceptance: continuation admission temporarily unavailable");
					}
					notifications.push({ session, id: value.id });
				},
			});
			const internal = runtime as unknown as {
				harness: Harness;
				background: ReturnType<typeof createBackground>;
				tools: Map<string, ToolRegistration>;
				invocationConfigs: WeakMap<object, { config: RuntimeSessionConfig; events: YEvent[] }>;
				registry: { install(extension: ReturnType<typeof defineExtension>): void };
			};
			const driver = defineTask<
				{ name: string; args: JsonObject; event?: YEvent },
				{ phase: "run" },
				ToolExecutionResult
			>({
				name: "yonder.background-check",
				version: 1,
				initial: () => ({ phase: "run" }),
				phases: {
					async run(job, task, context) {
						const api = {
							conversationId: job.conversationId,
							taskId: job.id,
							callId: `check-${job.id}`,
							async commit(change, ctx) {
								let result: unknown;
								await task.commit(async (tx) => {
									result = await change(tx);
									return undefined;
								}, ctx);
								return result;
							},
							async createTask(child, input, options, ctx) {
								let id: TaskId | undefined;
								await task.commit(async (tx) => {
									id = await tx.createTask(child, input, { ...options, conversationId: job.conversationId });
									return undefined;
								}, ctx);
								if (id === undefined) throw new Error("Native child task was not committed");
								return id;
							},
						} as ToolExecutionApi;
						const tool = internal.tools.get(job.input.name);
						if (!tool) throw new Error(`Missing actual tool ${job.input.name}`);
						if (job.input.event)
							internal.invocationConfigs.set(context, {
								config: await runtime!.sessionConfig(String(job.conversationId)),
								events: [job.input.event],
							});
						let result: ToolExecutionResult;
						try {
							result = await tool.execute(job.input.args, api, context);
						} finally {
							internal.invocationConfigs.delete(context);
						}
						await task.commit(() => ({ status: "terminal", outcome: { status: "completed", result } }), context);
					},
				},
				async abort(_job, task, context) {
					await task.commit(
						() => ({ status: "terminal", outcome: { status: "completed", result: { isError: true } } }),
						context,
					);
				},
			});
			internal.registry.install(defineExtension({ name: "yonder.background-check", tasks: [driver] }));
			const first = await runtime.create({ agent: null, profile: "default", cwd: home });
			const other = await runtime.create({ agent: null, profile: "default", cwd: home });
			await runtime.configure(first);
			await runtime.configure(other);
			const start = (session: string, name: string, args: JsonObject, event?: YEvent) =>
				internal.harness.commit(
					(tx) =>
						tx.createTask(
							driver,
							{ name, args, ...(event ? { event } : {}) },
							{ conversationId: Number(session) as never, ownership: { kind: "conversation" }, background: true },
						),
					C,
				);
			const done = async (id: TaskId<ToolExecutionResult>) => {
				const task = await internal.harness.waitForTask(id, C);
				if (task.state.outcome.status !== "completed")
					throw new Error(`Native task failed: ${JSON.stringify(task.state.outcome)}`);
				return task.state.outcome.result;
			};
			const call = async (session: string, name: string, args: JsonObject, event?: YEvent) =>
				done(await start(session, name, args, event));
			const text = (result: ToolExecutionResult) =>
				result.output
					?.filter((part) => part.type === "text")
					.map((part) => (part.type === "text" ? part.text : ""))
					.join("") ?? "";
			if (scenario === "scope") {
				const id = JSON.parse(text(await call(first, "bash", { command: "printf ready; sleep 30", background: true })))
					.background as string;
				await expect.poll(() => internal.background.running.get(Number(id))?.output).toBe("ready");
				expect(await runtime.backgroundList(first)).toContainEqual(expect.objectContaining({ id, name: "bash" }));
				expect(await runtime.backgroundList(other)).toEqual([]);
				expect(await runtime.backgroundAction(first, { action: "log", id })).toMatchObject({ output: "ready" });
				await expect(runtime.backgroundAction(other, { action: "log", id })).rejects.toThrow("not found");
				await expect(runtime.backgroundAction(other, { action: "kill", id })).rejects.toThrow("not found");
				await expect(runtime.backgroundAction(first, { action: "log", id, offset: -1 })).rejects.toThrow("offset");
				expect(changes).toContain(first);
				expect(changes).not.toContain(other);
				const before = changes.length;
				await runtime.backgroundAction(first, { action: "kill", id });
				await expect.poll(() => changes.length).toBeGreaterThan(before);
				expect(await runtime.backgroundAction(first, { action: "status", id })).toMatchObject({
					state: { status: "terminal", outcome: { status: "aborted" } },
				});
				return;
			}
			const short = await call(first, "bash", {
				command: "printf 'real short stdout'; printf 'real short stderr' >&2; exit 7",
			});
			expect(short.isError).toBe(true);
			expect(JSON.parse(text(short)).output).toContain("real short stdout");
			expect(JSON.parse(text(short)).output).toContain("real short stderr");
			expect(JSON.parse(text(short))).toMatchObject({
				stderr: "real short stderr",
				exitCode: 7,
			});
			expect(short.details).toHaveProperty("fullOutputPath");
			expect(await readFile((short.details as { fullOutputPath: string }).fullOutputPath, "utf8")).toContain(
				"real short stdout",
			);
			expect(internal.background.running.size).toBe(0);
			const eof = await call(first, "bash", { command: "cat" });
			expect(JSON.parse(text(eof))).toMatchObject({ output: "", exitCode: 0 });
			await writeFile(join(home, "stdin.txt"), "native stdin file match\n");
			// The EOF/file regression must run on hosts without optional ripgrep installed.
			const search = await call(first, "bash", { command: "cat; grep -H 'native stdin file match' stdin.txt" });
			expect(JSON.parse(text(search))).toMatchObject({ output: "stdin.txt:native stdin file match\n", exitCode: 0 });

			const began = Date.now();
			const yielded = await call(first, "bash", { command: "printf 'started'; sleep 16; printf 'finished'" });
			expect(Date.now() - began).toBeGreaterThanOrEqual(14900);
			// Upper bound tolerates scheduler load; the live "not terminal" check below proves it yielded early.
			expect(Date.now() - began).toBeLessThan(18000);
			const id = JSON.parse(text(yielded)).background as string;
			expect(id).toMatch(/^\d+$/);
			const active = await call(first, "process", { action: "status", id });
			expect(JSON.parse(text(active)).state.status).not.toBe("terminal");
			const completed = await call(first, "process", { action: "wait", id });
			expect(JSON.parse(text(completed)).state.status).toBe("terminal");
			expect(JSON.parse(text(completed)).output).toBe("startedfinished");
			expect(JSON.parse(text(completed)).state.outcome.result.output[0].text).toContain("startedfinished");
			await expect
				.poll(() => notifications.some((item) => item.id === id && item.session === first), { timeout: 5000 })
				.toBe(true);
			expect(internal.background.running.size).toBe(0);
			expect(reports.some((e) => String(e).includes("admission temporarily unavailable"))).toBe(true);
			expect(notifications.filter((item) => item.id === id)).toHaveLength(1);
			await expect.poll(() => idle).toBe(1);

			const input = JSON.parse(text(await call(first, "bash", { command: "cat", stdin: true, background: true })))
				.background as string;
			await expect.poll(() => typeof internal.background.running.get(Number(input))?.write).toBe("function");
			const crossEof = await start(other, "process", { action: "write", id: input, eof: true });
			expect((await internal.harness.waitForTask(crossEof, C)).state.outcome.status).not.toBe("completed");
			await call(first, "process", { action: "write", id: input, text: "pipe input\n", eof: true });
			const echoed = JSON.parse(text(await call(first, "process", { action: "wait", id: input })));
			expect(echoed.state.outcome.status).toBe("completed");
			expect(JSON.parse(echoed.state.outcome.result.output[0].text)).toMatchObject({
				output: "pipe input\n",
				exitCode: 0,
			});
			await expect.poll(() => idle).toBe(2);

			// Killing a native job before its yield must retain its actual non-completed outcome.
			const synchronous = await start(first, "bash", { command: "printf 'synchronous start'; sleep 30" });
			await expect
				.poll(() => [...internal.background.running.values()].some((value) => value.output === "synchronous start"))
				.toBe(true);
			const synchronousId = [...internal.background.running].find(
				([, value]) => value.output === "synchronous start",
			)?.[0];
			expect(synchronousId).toBeDefined();
			await call(first, "process", { action: "kill", id: String(synchronousId) });
			const cancelled = await done(synchronous);
			expect(cancelled.isError).toBe(true);
			expect(text(cancelled)).toBe("Cancelled");
			const cancelledLog = JSON.parse(text(await call(first, "process", { action: "log", id: String(synchronousId) })));
			expect(cancelledLog).toMatchObject({ output: "synchronous start", next: "synchronous start".length });

			const rolling = JSON.parse(
				text(
					await call(first, "bash", {
						command: "head -c 70000 /dev/zero | tr '\\0' x; read line; printf '%s' \"$line\"; sleep 30",
						stdin: true,
						background: true,
					}),
				),
			).background as string;
			await expect.poll(() => internal.background.running.get(Number(rolling))?.next).toBe(70000);
			const window = JSON.parse(text(await call(first, "process", { action: "log", id: rolling, offset: 0 })));
			expect(window).toMatchObject({ offset: 4464, next: 70000, truncated: true });
			expect(window.output).toHaveLength(65536);
			await call(first, "process", { action: "write", id: rolling, text: "NEW_TAIL\n" });
			await expect.poll(() => internal.background.running.get(Number(rolling))?.output.endsWith("NEW_TAIL")).toBe(true);
			const delta = JSON.parse(text(await call(first, "process", { action: "log", id: rolling, offset: window.next })));
			expect(delta).toMatchObject({ output: "NEW_TAIL", offset: 70000, next: 70008, truncated: false });
			const notificationsBeforeKill = notifications.length;
			await call(first, "process", { action: "kill", id: rolling });
			await expect.poll(() => idle).toBe(3);
			expect(notifications).toHaveLength(notificationsBeforeKill);
			expect(await runtime.hasPendingWork(first)).toBe(false);
			expect(await runtime.hasAwakeWork(first)).toBe(false);
			const retained = JSON.parse(
				text(await call(first, "process", { action: "log", id: rolling, offset: window.next })),
			);
			expect(retained).toMatchObject({ output: "NEW_TAIL", next: 70008, state: { outcome: { status: "aborted" } } });

			const source = newEvent({ type: "message.in", data: { text: "native background scope check" } });
			const interactive = JSON.parse(
				text(
					await call(
						first,
						"bash",
						{
							command: "printf 'ready'; read line; printf 'received:%s' \"$line\"; sleep 30",
							background: true,
							stdin: true,
						},
						source,
					),
				),
			).background as string;
			await expect.poll(() => internal.background.running.get(Number(interactive))?.output).toBe("ready");
			expect(changes).toContain(first);
			expect(changes).not.toContain(other);
			expect(await runtime.backgroundList(first)).toContainEqual(
				expect.objectContaining({ id: interactive, name: "bash" }),
			);
			expect(await runtime.backgroundList(other)).toEqual([]);
			expect(await runtime.backgroundAction(first, { action: "log", id: interactive })).toMatchObject({
				output: "ready",
			});
			await expect(runtime.backgroundAction(other, { action: "log", id: interactive })).rejects.toThrow("not found");
			await expect(runtime.backgroundAction(other, { action: "kill", id: interactive })).rejects.toThrow("not found");
			await expect(runtime.backgroundAction(first, { action: "log", id: interactive, offset: -1 })).rejects.toThrow(
				"offset",
			);
			expect(await runtime.hasPendingWork(first)).toBe(true);
			expect(await runtime.hasAwakeWork(first)).toBe(true);
			expect(await runtime.activity(first)).toMatchObject({
				state: "running",
				execution: { phase: "running" },
				detail: "执行 bash",
				text: "",
			});
			expect(await runtime.activity(other)).toMatchObject({
				state: "idle",
				execution: { phase: "idle" },
				summary: "",
				text: "",
			});
			expect(await runtime.hasPendingWork(first, source.id)).toBe(true);
			expect(
				await runtime.hasPendingWork(first, newEvent({ type: "message.in", data: { text: "independent request" } }).id),
			).toBe(false);
			await call(first, "process", { action: "write", id: interactive, text: "stdin works\n" });
			await expect
				.poll(() => internal.background.running.get(Number(interactive))?.output)
				.toContain("received:stdin works");
			const log = JSON.parse(text(await call(first, "process", { action: "log", id: interactive, offset: 5 })));
			expect(log.output).toBe("received:stdin works");
			const cross = await start(other, "process", { action: "kill", id: interactive });
			const crossResult = await internal.harness.waitForTask(cross, C);
			expect(crossResult.state.outcome.status).not.toBe("completed");
			expect(internal.background.running.has(Number(interactive))).toBe(true);
			const changesBeforeKill = changes.length;
			await runtime.backgroundAction(first, { action: "kill", id: interactive });
			await expect.poll(() => internal.background.running.size).toBe(0);
			await expect.poll(() => changes.length).toBeGreaterThan(changesBeforeKill);
			const owned = await internal.harness.getTask(Number(interactive) as TaskId, C);
			expect(owned?.conversationId).toBe(Number(first));
			expect(owned?.owner).toBeUndefined();
			expect(owned?.background).toBe(true);

			const abortable = JSON.parse(
				text(await call(first, "bash", { command: "sleep 30 & echo $$:$!; wait", background: true })),
			).background as string;
			await expect.poll(() => internal.background.running.get(Number(abortable))?.output.trim()).toMatch(/^\d+:\d+$/);
			const abortPids = internal.background.running.get(Number(abortable))?.output.trim().split(":").map(Number) ?? [];
			await runtime.abort(first);
			await expect.poll(() => internal.background.running.size).toBe(0);
			for (const pid of abortPids)
				await expect
					.poll(() => {
						try {
							process.kill(pid, 0);
							return true;
						} catch {
							return false;
						}
					})
					.toBe(false);

			const shutdown = JSON.parse(
				text(await call(first, "bash", { command: "sleep 30 & echo $$:$!; wait", background: true })),
			).background as string;
			await expect.poll(() => internal.background.running.get(Number(shutdown))?.output.trim()).toMatch(/^\d+:\d+$/);
			const pids = internal.background.running.get(Number(shutdown))?.output.trim().split(":").map(Number) ?? [];
			await runtime.close();
			runtime = undefined;
			expect(internal.background.running.size).toBe(0);
			for (const pid of pids)
				await expect
					.poll(() => {
						try {
							process.kill(pid, 0);
							return true;
						} catch {
							return false;
						}
					})
					.toBe(false);
		} finally {
			await runtime?.close();
			await rm(home, { recursive: true, force: true });
		}
	},
	30000,
);
