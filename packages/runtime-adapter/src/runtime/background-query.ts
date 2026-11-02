import { BACKGROUND_CONTEXT as C } from "@earendil-works/chord/context";
import { InboxDoc, LiveDoc } from "@earendil-works/pi-durable";
import type { ToolContext } from "@yonder/sdk";
import { cid, SessionDoc } from "./docs.js";
import type { RuntimeInternals } from "./instance.js";
import type { RuntimeActivityExecution } from "./types.js";

export async function hasBackgroundWork(
	rt: RuntimeInternals,
	id: string,
	except?: number,
	input?: string,
): Promise<boolean> {
	const tasks = await rt.storage.scanTasks(
		{ conversationId: cid(id), kind: "yonder.background" },
		Number.MAX_SAFE_INTEGER,
		undefined,
		C,
	);
	for (const task of tasks.items) {
		if (task.id === except) continue;
		if (input) {
			const config = (task.input as { config?: string }).config;
			const events = config ? (JSON.parse(config) as { events: import("@yonder/sdk").YEvent[] }).events : [];
			let belongs = false;
			for (const event of events)
				if (await rt.causedBy(event, input)) {
					belongs = true;
					break;
				}
			if (!belongs) continue;
		}
		if (task.state.status !== "terminal") return true;
		if (await rt.background.pending(task.id)) return true;
	}
	return false;
}
export async function hasOtherBackgroundWork(rt: RuntimeInternals, ctx: ToolContext) {
	const invocation = rt.toolInvocations.get(ctx);
	if (!invocation) throw new Error("Requires an active runtime tool invocation");
	return rt.hasBackgroundWork(ctx.session, invocation.api.taskId);
}
/** Read native state only; waiting for a UI answer is not executable work. */
export async function hasAwakeWork(rt: RuntimeInternals, id: string): Promise<boolean> {
	const tasks = await rt.storage.scanTasks(
		{ conversationId: cid(id), kind: "yonder.background" },
		Number.MAX_SAFE_INTEGER,
		undefined,
		C,
	);
	const pending = tasks.items.filter((task) => task.state.status !== "terminal");

	if (pending.some((task) => (task.input as { name?: string }).name !== "interaction_result")) return true;
	const inbox = await rt.harness.snapshot(InboxDoc, cid(id), C);
	if (inbox?.items.some((item) => item.mode !== "write")) return true;
	const live = await rt.harness.snapshot(LiveDoc, cid(id), C);
	const slots = live?.tools?.filter((slot) => slot.status !== "done") ?? [];
	return !!live?.run && !(slots.length > 0 && slots.every((slot) => slot.name === "interaction_result"));
}
export async function backgroundList(rt: RuntimeInternals, session: string) {
	return rt.background.list(session, rt.storage);
}
export async function backgroundAction(
	rt: RuntimeInternals,
	session: string,
	args: { action: "status" | "log" | "kill"; id: string; offset?: number },
) {
	return rt.background.manage(session, args);
}
export async function backgroundChild(rt: RuntimeInternals, session: string, id: string) {
	const job = await rt.background.manage(session, { action: "status", id });
	if (!("name" in job) || job.name !== "task_run") throw new Error("Not a delegated task");
	const page = await rt.harness.commit((tx) => tx.scanConversations({ ownerTaskId: Number(id) as never }, 1), C);
	if (!page.items[0]) throw new Error("Child task has not started");
	return { session: String(page.items[0].id), state: job.state };
}
/** Owner-local presentation, projected from native live state, never reasoning or tool payloads. */
export async function activity(rt: RuntimeInternals, id: string) {
	const [live, inbox, background, activity] = await Promise.all([
		rt.harness.snapshot(LiveDoc, cid(id), C),
		rt.harness.snapshot(InboxDoc, cid(id), C),
		rt.storage.scanTasks({ conversationId: cid(id), kind: "yonder.background" }, Number.MAX_SAFE_INTEGER, undefined, C),
		rt.harness.snapshot(SessionDoc, cid(id), C),
	]);
	const tools = [...(live?.tools ?? []), ...(live?.nestedTools ?? [])]
		.filter((slot) => slot.status !== "done")
		.map((slot) => slot.name);
	tools.push(
		...background.items
			.filter((task) => task.state.status !== "terminal")
			.map((task) => (task.input as { name: string }).name),
	);
	const queued = inbox?.items.some((item) => item.mode !== "write");
	const busy = !!live?.run || !!queued || tools.length > 0 || !!live?.compactions?.length;
	const waiting =
		busy &&
		!queued &&
		!live?.compactions?.length &&
		tools.length > 0 &&
		tools.every((name) => name === "interaction_result");
	const runId = live?.run ? String(live.run.inputs[0]) : undefined;
	const generationRetry = live?.run ? live.generation?.retry?.at : undefined;
	const compactions = live?.compactions ?? [];
	const compactionRetry =
		compactions.length > 0 && compactions.every((task) => task.retry)
			? Math.min(...compactions.map((task) => task.retry?.at ?? Infinity))
			: undefined;
	const retryAt = generationRetry ?? compactionRetry;
	const retrying =
		retryAt !== undefined &&
		tools.length === 0 &&
		(!live?.run || generationRetry !== undefined || compactions.some((task) => task.blocking)) &&
		compactions.every((task) => task.retry);
	const execution: RuntimeActivityExecution = {
		phase: waiting
			? "waiting-input"
			: busy
				? retrying
					? "retrying"
					: "running"
				: activity?.activityIssue
					? "blocked"
					: "idle",
		...(runId ? { runId } : {}),
		...(retryAt === undefined ? {} : { retryAt }),
		...(activity?.activityIssue ? { issue: activity.activityIssue } : {}),
	};
	let summary = "";
	const input = live?.run?.inputs.at(-1);
	if (input !== undefined) {
		const submission = await rt.storage.submission(input, C);
		const entry = submission?.entry ? await rt.harness.commit((tx) => tx.entry(submission.entry!), C) : undefined;
		const message = entry?.model?.find((message) => message.role === "user");
		if (message)
			summary =
				typeof message.content === "string"
					? message.content
					: message.content
							.filter((block) => block.type === "text")
							.map((block) => block.text)
							.join(" ");
	}
	const text =
		live?.generation?.message?.content
			.filter((block) => block.type === "text")
			.map((block) => block.text)
			.join(" ") ?? "";
	const detail =
		execution.phase === "retrying"
			? "重试中"
			: execution.phase === "blocked"
				? "执行受阻"
				: waiting
					? "等待交互"
					: live?.compactions?.length
						? "整理上下文"
						: tools.length
							? `执行 ${[...new Set(tools)].join(" · ")}`
							: queued && !live?.run
								? "排队中"
								: busy
									? "生成回复"
									: "空闲";
	return {
		execution,
		state: waiting ? ("waiting" as const) : busy ? ("running" as const) : ("idle" as const),
		summary: summary.replace(/\s+/g, " ").trim().slice(0, 160),
		detail: detail.slice(0, 160),
		text: text.trim().slice(-240),
	};
}
