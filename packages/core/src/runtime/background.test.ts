import { mkdtemp, readFile, rm } from "node:fs/promises";
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
import { expect, test } from "vitest";
import { resolveProfile } from "../config/index.js";
import type { createBackground } from "./background.js";
import { openDatabase } from "./db.js";
import { Runtime } from "./index.js";

// Native task driver replaces only model selection of tool name/arguments. The
// real Yonder wrapper, pi task scheduler, SQLite, env and process tool all run.
test("native background preserves results, yields at 15s, owns processes and releases work", async () => {
	const home = await mkdtemp(join(tmpdir(), "yonder-background-"));
	const reports: unknown[] = [];
	let failedAdmission = false;
	const notifications: Array<{ session: string; id: string }> = [];
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
			registry: { install(extension: ReturnType<typeof defineExtension>): void };
		};
		const driver = defineTask<{ name: string; args: JsonObject }, { phase: "run" }, ToolExecutionResult>({
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
					const result = await tool.execute(job.input.args, api, context);
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
		const start = (session: string, name: string, args: JsonObject) =>
			internal.harness.commit(
				(tx) =>
					tx.createTask(
						driver,
						{ name, args },
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
		const call = async (session: string, name: string, args: JsonObject) => done(await start(session, name, args));
		const text = (result: ToolExecutionResult) =>
			result.output
				?.filter((part) => part.type === "text")
				.map((part) => (part.type === "text" ? part.text : ""))
				.join("") ?? "";
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

		const began = Date.now();
		const yielded = await call(first, "bash", { command: "printf 'started'; sleep 16; printf 'finished'" });
		expect(Date.now() - began).toBeGreaterThanOrEqual(14900);
		expect(Date.now() - began).toBeLessThan(16000);
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

		const interactive = JSON.parse(
			text(
				await call(first, "bash", {
					command: "printf 'ready'; read line; printf 'received:%s' \"$line\"; sleep 30",
					background: true,
				}),
			),
		).background as string;
		await expect.poll(() => internal.background.running.get(Number(interactive))?.output).toBe("ready");
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
		await call(first, "process", { action: "kill", id: interactive });
		await expect.poll(() => internal.background.running.size).toBe(0);
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
}, 30000);
