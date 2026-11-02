import { BACKGROUND_CONTEXT as C } from "@earendil-works/chord/context";
import { InboxDoc, LiveDoc, type Submission, watchEvents } from "@earendil-works/pi-durable";
import type { ToolContext } from "@yonder/sdk";
import { cid, emptyUsage, SessionDoc, submissionOutcome } from "./docs.js";
import { inputEntry } from "./input-entry.js";
import type { RuntimeInternals } from "./instance.js";
import { notificationRequestId, writeNotification } from "./notifications.js";
import { projectOutput } from "./output.js";
import type { RuntimeInput, RuntimeRun } from "./types.js";
import { isOwnerWorkbenchInput } from "./workbench-options.js";

export async function notificationRecorded(rt: RuntimeInternals, id: string, from: string, event: string) {
	return Boolean(await rt.storage.submissionByRequest(cid(id), notificationRequestId(from, event), C));
}
export async function notify(rt: RuntimeInternals, id: string, input: { from: string; event: string; text: string }) {
	return writeNotification(await rt.conversation(id), input);
}
export async function submit(
	rt: RuntimeInternals,
	id: string,
	input: RuntimeInput,
	accepted?: () => void,
): Promise<RuntimeRun> {
	const conversation = await rt.conversation(id);
	// Non-owner channel input must start its own run, never steer an elevated owner snapshot.
	if (rt.currentConfig(id)?.ownerWorkbench && !isOwnerWorkbenchInput(input.event))
		input = { ...input, busy: "followup" };
	const requestId = input.requestId ?? (input.event ? `event:${input.event.id}` : undefined);
	const existing = requestId ? await rt.storage.submissionByRequest(cid(id), requestId, C) : undefined;
	const content = [{ type: "text" as const, text: input.text }];
	let stream = input.onOutput ? await watchEvents(rt.harness, cid(id), C) : undefined;
	let submission: Submission | undefined;
	let submitted!: () => void;
	const ready = new Promise<void>((resolve) => {
		submitted = resolve;
	});
	let participating = false;
	let outputRun: string | undefined;
	const textBlocks = new Map<number, string>();
	stream?.start(async (events) => {
		await ready;
		for (const event of events) {
			if (event.type === "run_start" || event.type === "snapshot")
				participating =
					!!submission &&
					(event.type === "run_start" ? event.inputs : (event.run?.inputs ?? [])).includes(submission.id);
			if (event.type === "run_start" || event.type === "snapshot")
				outputRun = String((event.type === "run_start" ? event.inputs : event.run?.inputs)?.[0] ?? "");
			if (
				event.type === "submission" &&
				submission &&
				event.record.id === submission.id &&
				event.record.status === "placed"
			)
				participating = true;
			if (participating) {
				if (!outputRun) outputRun = String((await rt.harness.snapshot(LiveDoc, cid(id), C))?.run?.inputs[0] ?? "");
				projectOutput(event, { ...input, onOutput: (part) => input.onOutput?.(part, outputRun) }, textBlocks);
			}
			if (event.type === "run_end") participating = false;
		}
	});
	const entry = inputEntry(input);
	try {
		submission = existing
			? await rt.harness.submission(existing.id, C)
			: await conversation.submit(
					input.wake === "write"
						? {
								type: "write",
								...(requestId ? { requestId } : {}),
								entry: { ...entry, model: [{ role: "user", content, timestamp: Date.now() }] },
							}
						: {
								type: "input",
								...(requestId ? { requestId } : {}),
								content,
								entry,
								whenBusy: input.busy === "followup" ? "followUp" : (input.busy ?? "steer"),
							},
					C,
				);
		if (!submission) throw new Error("Previously admitted submission disappeared");
		await rt.attachSubmission(submission, input.event, id);
		try {
			await rt.options.onAdmitted?.(id, input);
		} catch (error) {
			rt.options.onReport?.(error);
		}
		accepted?.();
		submitted();
		const done = await submission.wait(C);
		await stream?.stop();
		stream = undefined;
		if (input.wake === "write") {
			rt.submissions.delete(String(submission.id));
			return {
				runId: String(submission.id),
				...submissionOutcome(done),
				text: "",
				usage: emptyUsage(),
				inputs: input.event ? [input.event.id] : [],
			};
		}
		return await rt.settledRun(id, done);
	} finally {
		submitted();
		await stream?.stop();
	}
}
/** Resolve at durable admission; observe the eventual run without holding its caller. */
export async function enqueue(rt: RuntimeInternals, id: string, input: RuntimeInput): Promise<void> {
	await new Promise<void>((accept, reject) => {
		void rt.submit(id, input, accept).catch((error) => {
			reject(error);
			rt.options.onReport?.(error);
		});
	});
}
export function invocationId(rt: RuntimeInternals, ctx: ToolContext): string {
	const invocation = rt.toolInvocations.get(ctx);
	if (!invocation) throw new Error("Requires an active runtime tool invocation");
	return `${ctx.session}:${invocation.api.taskId}`;
}
export async function attachSubmission(
	rt: RuntimeInternals,
	submission: Submission,
	event: RuntimeInput["event"],
	_session: string,
): Promise<void> {
	rt.submissions.set(String(submission.id), { event });
}
export async function abort(rt: RuntimeInternals, id: string): Promise<void> {
	const [live, activity] = await Promise.all([
		rt.harness.snapshot(LiveDoc, cid(id), C),
		rt.harness.snapshot(SessionDoc, cid(id), C),
	]);
	const cancelledRun = live?.run ? String(live.run.inputs[0]) : (activity?.activityRunId ?? null);
	await (await rt.conversation(id)).abort(C, { background: true });
	await rt.harness.commit(async (tx) => {
		const state = await tx.doc(SessionDoc, cid(id));
		// A later input can already have started while cancellation joined its old scope.
		if ((state.activityRunId ?? null) !== cancelledRun) return;
		state.activityIssue = null;
		state.activityRunId = null;
	}, C);
}
export async function queued(rt: RuntimeInternals, id: string, withdraw = false) {
	const inbox = await rt.harness.snapshot(InboxDoc, cid(id), C);
	const result: Array<{ id: string; mode: string; text: string; event?: string }> = [];
	for (const item of inbox?.items ?? []) {
		if (item.mode === "write") continue;
		if (withdraw && (await rt.harness.abortSubmission(item.id, C, cid(id))) !== "aborted") continue;
		const content =
			typeof item.content === "string"
				? item.content
				: item.content
						.filter((block) => block.type === "text")
						.map((block) => block.text)
						.join("\n");
		const event =
			item.entry?.data && typeof item.entry.data === "object" && "event" in item.entry.data
				? String(item.entry.data.event)
				: undefined;
		result.push({ id: String(item.id), mode: item.mode, text: content, ...(event ? { event } : {}) });
	}
	return result;
}
