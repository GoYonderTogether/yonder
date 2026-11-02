import { BACKGROUND_CONTEXT as C } from "@earendil-works/chord/context";
import { RunReceiptDoc } from "@earendil-works/pi-durable";
import type { ToolContext } from "@yonder/sdk";
import { emptyUsage, SessionDoc } from "./docs.js";
import { inputEntry } from "./input-entry.js";
import type { RuntimeInternals } from "./instance.js";
import { taskReport } from "./results.js";
import type { RuntimeInput, RuntimeRun } from "./types.js";

export async function runTask(
	rt: RuntimeInternals,
	ctx: ToolContext,
	initialize: (childId: string) => Promise<RuntimeInput>,
): Promise<RuntimeRun> {
	const invocation = rt.toolInvocations.get(ctx);
	if (!invocation) throw new Error("task_run requires an active runtime tool invocation");
	const { api, context } = invocation;
	const child = await api.commit(async (tx) => {
		const existing = await tx.scanConversations({ ownerTaskId: api.taskId }, 1);
		if (existing.items[0]) return existing.items[0].id;
		const created = await tx.createConversation({ ownership: { kind: "task", taskId: api.taskId } });
		await tx.doc(SessionDoc, created.id);
		return created.id;
	}, context);
	const input = await initialize(String(child));
	try {
		const handle = await api.conversation(child, context);
		if (!handle) throw new Error("Child conversation is missing");
		// Invocation-bound submit preserves pi task ownership and idempotent task request IDs.
		const submission = await handle.submit(
			{
				type: "input",
				content: [{ type: "text", text: input.text }],
				requestId: `task:${api.taskId}`,
				entry: inputEntry(input),
			},
			context,
		);
		await rt.attachSubmission(submission, input.event, String(child));
		try {
			await rt.options.onAdmitted?.(String(child), input);
		} catch (error) {
			rt.options.onReport?.(error);
		}
		// Observe the admitted child outside the parent invocation; native ownership still cancels it.
		const admitted = await rt.harness.submission(submission.id, C);
		if (!admitted) throw new Error("Admitted child input is missing");
		const done = await admitted.wait(C);
		await rt.settledRun(String(child), done);
		while (true) {
			let changed!: () => void;
			const next = new Promise<void>((resolve) => {
				changed = resolve;
			});
			const waiters = rt.idleWaiters.get(String(child)) ?? new Set();
			waiters.add(changed);
			rt.idleWaiters.set(String(child), waiters);
			context.abortSignal?.addEventListener("abort", changed, { once: true });
			try {
				context.abortSignal?.throwIfAborted();
				if (!(await rt.hasPendingWork(String(child)))) break;
				await next;
				context.abortSignal?.throwIfAborted();
			} finally {
				context.abortSignal?.removeEventListener("abort", changed);
				waiters.delete(changed);
				if (!waiters.size) rt.idleWaiters.delete(String(child));
			}
		}
		const last = await rt.lastResult(String(child));
		if (!last) throw new Error("Child task has no terminal receipt");
		const receipt = await rt.harness.snapshot(RunReceiptDoc, child, last.runId, C);
		const result = await rt.receiptRun(String(child), last.runId, receipt!);
		return { ...result, text: taskReport(result.text) };
	} catch (error) {
		if (input.event && !(await rt.admitted(String(child), input.event.id)))
			await rt.options.onRun?.(String(child), {
				runId: `error:${input.event.id}`,
				session: String(child),
				status: "error",
				text: "",
				reason: error instanceof Error ? error.message : String(error),
				usage: emptyUsage(),
				inputs: [input.event.id],
			});
		throw error;
	}
}
