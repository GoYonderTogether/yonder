import { mkdtemp, rm } from "node:fs/promises";
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
import { resolveProfile } from "../config/test-support.js";
import { openDatabase } from "./db.js";
import { Runtime } from "./index.js";

// A native task driver stands in only for the model choosing tool names and arguments;
// the real Yonder tools, pi task scheduler, SQLite and OS bash all run.
test("bg_run/bg_status/bg_logs/bg_kill drive a real sleep+echo background job", async () => {
	const home = await mkdtemp(join(tmpdir(), "yonder-bg-tools-"));
	const notifications: Array<{ id: string; name: string; outputFile?: string }> = [];
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
			onBackground: async (_session, value) => {
				notifications.push({
					id: value.id,
					name: value.name,
					...(value.outputFile ? { outputFile: value.outputFile } : {}),
				});
			},
		});
		const internal = runtime as unknown as {
			harness: Harness;
			tools: Map<string, ToolRegistration>;
			registry: { install(extension: ReturnType<typeof defineExtension>): void };
		};
		const driver = defineTask<{ name: string; args: JsonObject }, { phase: "run" }, ToolExecutionResult>({
			name: "yonder.bg-tools-check",
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
					} as ToolExecutionApi;
					const tool = internal.tools.get(job.input.name);
					if (!tool) throw new Error(`Missing actual tool ${job.input.name}`);
					let result: ToolExecutionResult;
					try {
						result = await tool.execute(job.input.args, api, context);
					} catch (error) {
						result = { output: [{ type: "text", text: String(error) }], isError: true };
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
		internal.registry.install(defineExtension({ name: "yonder.bg-tools-check", tasks: [driver] }));
		const session = await runtime.create({ agent: null, profile: "default", cwd: home });
		await runtime.configure(session);
		const call = async (name: string, args: JsonObject) => {
			const id = await internal.harness.commit(
				(tx) =>
					tx.createTask(
						driver,
						{ name, args },
						{ conversationId: Number(session) as never, ownership: { kind: "conversation" }, background: true },
					),
				C,
			);
			const done = await internal.harness.waitForTask(id as TaskId<ToolExecutionResult>, C);
			if (done.state.outcome.status !== "completed") throw new Error(JSON.stringify(done.state.outcome));
			const result = done.state.outcome.result;
			return {
				isError: result.isError ?? false,
				text: (result.output ?? []).map((part) => (part.type === "text" ? part.text : "")).join(""),
			};
		};

		// Short job: named, yields immediately, and its completion notice carries the log path.
		const began = Date.now();
		const short = await call("bg_run", { name: "echo check", command: "echo HEAD-LINE; sleep 1; echo TAIL-LINE" });
		expect(Date.now() - began).toBeLessThan(5000);
		const shortId = JSON.parse(short.text).background as string;
		expect(shortId).toMatch(/^\d+$/);
		await expect.poll(() => notifications.some((item) => item.id === shortId), { timeout: 10_000 }).toBe(true);
		expect(notifications.find((item) => item.id === shortId)).toMatchObject({
			name: "echo check",
			outputFile: join(home, ".yonder", "background", `${shortId}.log`),
		});

		const status = await call("bg_status", { taskId: shortId });
		expect(status.text).toContain(`✓ ${shortId} completed`);
		expect(status.text).toContain("exit=0");
		expect(status.text).toContain("— echo check");

		const full = await call("bg_logs", { taskId: shortId });
		expect(full.text).toContain("HEAD-LINE\nTAIL-LINE\n");
		expect(full.text).toContain(`[Full output: ${join(home, ".yonder", "background", `${shortId}.log`)}]`);
		const tail = await call("bg_logs", { taskId: shortId, maxBytes: 10 });
		expect(tail.text).toMatch(/^\[Showing tail 10B of 20B; 10B omitted\. Full output: .+\.log\]\n\nTAIL-LINE\n$/);
		const head = await call("bg_logs", { taskId: shortId, maxBytes: 10, tail: false });
		expect(head.text).toMatch(/^HEAD-LINE\n\n\n\[Showing head 10B of 20B; 10B omitted\. Full output: .+\.log\]$/);
		// maxBytes is capped at 50KB rather than rejected.
		expect((await call("bg_logs", { taskId: shortId, maxBytes: 10_000_000 })).text).toContain("[Full output:");

		// Long job: killed through bg_kill reports killed, and a second kill fails loudly.
		const long = JSON.parse((await call("bg_run", { command: "echo started; sleep 60", notify: false })).text)
			.background as string;
		await expect
			.poll(async () => (await call("bg_logs", { taskId: long })).text, { timeout: 10_000 })
			.toContain("started");
		expect((await call("bg_status", {})).text).toContain(`▶ ${long} running`);
		const killed = await call("bg_kill", { taskId: long });
		expect(killed.isError).toBe(false);
		expect(killed.text).toContain(`Killed background task echo started; sleep 60 (${long})`);
		await expect.poll(async () => (await call("bg_status", { taskId: long })).text).toContain(`■ ${long} killed`);
		const again = await call("bg_kill", { taskId: long });
		expect(again.isError).toBe(true);
		expect(again.text).toContain("already finished (killed)");
		expect((await call("bg_logs", { taskId: "999999999" })).text).toContain("not found");
		expect(notifications.some((item) => item.id === long)).toBe(false);
		await expect.poll(() => runtime!.hasPendingWork(session)).toBe(false);
	} finally {
		await runtime?.close();
		await rm(home, { recursive: true, force: true });
	}
}, 60_000);
