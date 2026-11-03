import { BACKGROUND_CONTEXT as C } from "@earendil-works/chord/context";
import { InboxDoc, LiveDoc, RunReceiptDoc } from "@earendil-works/pi-durable";
import { cid, RunDoc, submissionOutcome } from "./docs.js";
import type { RuntimeInternals } from "./instance.js";
import { RESTART_NOTICE } from "./recovery.js";
import { entryText as textOf } from "./transcript.js";

/** Read and project durable endings before any submit/wait/resume starts scheduling. */
export async function recover(rt: RuntimeInternals): Promise<void> {
	rt.restoring = true;
	const conversations = await rt.storage.scanConversations({}, Number.MAX_SAFE_INTEGER, undefined, C);
	for (const conversation of conversations.items) {
		const covered = new Set<number>();
		const docs = await rt.storage.scanDocuments(
			{ scope: { kind: "conversation", conversationId: conversation.id }, kind: "pi.run-receipt", at: "current" },
			Number.MAX_SAFE_INTEGER,
			undefined,
			C,
		);
		let skipped = false;
		for (const doc of docs.items) {
			const receipt = await rt.harness.snapshot(RunReceiptDoc, conversation.id, doc.key!, C);
			for (const input of receipt?.inputs ?? []) covered.add(input);
			if (receipt) {
				// A run whose run.end is durable was fully settled before this start. Replaying every historical run
				// made startup grow with runs x conversation size (about two minutes for Jarvis' main session).
				if (await rt.options.settled?.(String(conversation.id), doc.key!)) {
					rt.settledEvents.set(String(conversation.id), doc.key!);
					skipped = true;
					continue;
				}
				try {
					await rt.receiptRun(String(conversation.id), doc.key!, receipt);
				} catch (error) {
					rt.options.onReport?.(error);
				}
			}
		}
		// Settled runs skipped their idle hook; let waiters and sessions re-evaluate once per conversation.
		if (skipped) await rt.idleChanged(String(conversation.id)).catch((error) => rt.options.onReport?.(error));
		await rt.outbox.deliver(String(conversation.id)).catch((error) => rt.options.onReport?.(error));
		const live = await rt.harness.snapshot(LiveDoc, conversation.id, C);
		if (live?.run) {
			try {
				await rt.prepareRun(String(conversation.id), C);
			} catch (error) {
				// A revoked binding faults only its native task on resume, not unrelated conversations/startup.
				rt.options.onReport?.(error);
			}
			rt.interrupted.push({ session: String(conversation.id), run: String(live.run.inputs[0]) });
		}
		const records = await rt.storage.scanSubmissions(
			{ conversationId: conversation.id },
			Number.MAX_SAFE_INTEGER,
			undefined,
			C,
		);
		for (const record of records.items) {
			if (record.type !== "input") continue;
			if (record.status === "queued" || record.status === "placed")
				rt.recovering.push({ session: String(conversation.id), id: record.id });
			else if (!record.entry) {
				try {
					await rt.settledRun(String(conversation.id), record);
				} catch (error) {
					rt.options.onReport?.(error);
				}
			} else if (!covered.has(record.id))
				rt.options.onReport?.(new Error(`历史 submission ${record.id} 无原生回执，归属/结束用量不可确定；不重新执行`));
		}
	}
}
export function resume(rt: RuntimeInternals): void {
	rt.restoring = false;
	for (const state of rt.limits.states.values()) if (!state.timer) rt.limits.arm(state);
	// Admit notes before a recovered request can pass beforeAgent, including
	// requests whose checkpoint is already in the request phase.
	rt.restartNotes = Promise.all(
		rt.interrupted.splice(0).map(({ session, run }) =>
			(async () => {
				const state = await rt.harness.snapshot(RunDoc, cid(session), run, C);
				if (state?.networkInterrupted) return;
				await rt.writeNote(session, `restart:${run}`, RESTART_NOTICE);
				await rt.harness.commit(async (tx) => {
					(await tx.doc(RunDoc, cid(session), run, null)).networkInterrupted = true;
				}, C);
			})().catch((error) => rt.options.onReport?.(error)),
		),
	).then(() => {});
	for (const item of rt.recovering.splice(0)) {
		void (async () => {
			const submission = await rt.harness.submission(item.id, C);
			if (submission) await rt.settledRun(item.session, await submission.wait(C));
		})().catch(rt.options.onReport ?? (() => {}));
	}
	void rt.storage
		.scanTasks({ kind: "yonder.background" }, Number.MAX_SAFE_INTEGER, undefined, C)
		.then((page) => rt.background.recover(page.items))
		.catch((error) => rt.options.onReport?.(error));

	rt.harness.resume();
}
export async function idleChanged(rt: RuntimeInternals, session: string): Promise<void> {
	for (const changed of rt.idleWaiters.get(session) ?? []) changed();
	await rt.options.onIdle?.(session);
	if (!rt.options.onSessionSettled || (await rt.hasPendingWork(session))) return;
	const result = await rt.lastResult(session);
	if (result && rt.settledEvents.get(session) !== result.runId) {
		rt.settledEvents.set(session, result.runId);
		await rt.options.onSessionSettled?.({ session, status: result.status === "limit" ? "idle" : result.status });
	}
}
export async function causedBy(
	rt: RuntimeInternals,
	source: import("@yonder/sdk").YEvent | undefined,
	input: string,
): Promise<boolean> {
	const seen = new Set<string>();
	while (source && !seen.has(source.id)) {
		if (source.id === input) return true;
		seen.add(source.id);
		source = source.parent ? await rt.options.readEvent?.(source.parent) : undefined;
	}
	return false;
}
export async function lastResult(rt: RuntimeInternals, session: string, input?: string) {
	const docs = await rt.storage.scanDocuments(
		{ scope: { kind: "conversation", conversationId: cid(session) }, kind: "pi.run-receipt", at: "current" },
		Number.MAX_SAFE_INTEGER,
		undefined,
		C,
	);
	for (const doc of [...docs.items].sort((a, b) => b.id - a.id)) {
		const receipt = await rt.harness.snapshot(RunReceiptDoc, cid(session), doc.key!, C);
		if (!receipt?.settlement) continue;
		let matches = input === undefined;
		if (input)
			for (const source of await rt.sources(receipt.inputs)) {
				if (await rt.causedBy(source, input)) {
					matches = true;
					break;
				}
			}
		if (matches) {
			const state = await rt.harness.snapshot(RunDoc, cid(session), doc.key!, C);
			return {
				runId: doc.key!,
				...(state?.error
					? { status: "error" as const, reason: state.error }
					: submissionOutcome(receipt.settlement, state?.reason ?? undefined)),
			};
		}
	}
}
export async function resultText(rt: RuntimeInternals, session: string, runId: string): Promise<string> {
	const receipt = await rt.harness.snapshot(RunReceiptDoc, cid(session), runId, C);
	const end = receipt?.settlement;
	return end?.status === "done" ? textOf(await rt.harness.commit((tx) => tx.entry(end.answer), C)) : "";
}
export async function responseText(rt: RuntimeInternals, session: string, event: string): Promise<string> {
	const record = await rt.storage.submissionByRequest(cid(session), `event:${event}`, C);
	return record?.status === "done" && record.answer
		? textOf(await rt.harness.commit((tx) => tx.entry(record.answer!), C))
		: "";
}
export async function admitted(rt: RuntimeInternals, session: string, event: string): Promise<boolean> {
	if (await rt.storage.submissionByRequest(cid(session), `event:${event}`, C)) return true;
	const inbox = await rt.harness.snapshot(InboxDoc, cid(session), C);
	if (inbox?.items.some((item) => (item.entry?.data as { event?: string } | undefined)?.event === event)) return true;
	const entries = await rt.storage.scanEntries({ conversationId: cid(session) }, Number.MAX_SAFE_INTEGER, undefined, C);
	return entries.items.some((entry) => (entry.data as { event?: string } | undefined)?.event === event);
}
