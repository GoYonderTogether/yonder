import { BACKGROUND_CONTEXT as C } from "@earendil-works/chord/context";
import { RunReceiptDoc, type RunReceiptState, type Submission } from "@earendil-works/pi-durable";
import type { Attachment } from "@yonder/sdk";
import { cid, emptyUsage, RunDoc, SessionDoc, submissionOutcome, sumUsage } from "./docs.js";
import type { RuntimeInternals } from "./instance.js";
import { runAttempts } from "./model-watch.js";
import { entryText as textOf } from "./transcript.js";
import type { RuntimeRun, RuntimeSessionConfig } from "./types.js";

export async function sources(rt: RuntimeInternals, ids: readonly number[]): Promise<import("@yonder/sdk").YEvent[]> {
	const events: import("@yonder/sdk").YEvent[] = [];
	for (const id of ids) {
		const record = await rt.storage.submission(id as import("@earendil-works/pi-durable").SubmissionId, C);
		const entry = record?.entry ? await rt.harness.commit((tx) => tx.entry(record.entry!), C) : undefined;
		let data = entry?.data as { event?: string; attachments?: import("@yonder/sdk").Attachment[] } | undefined;
		if (entry) {
			// The prepared entry that targets an input is written before that input is answered, so an answered
			// input never needs the rest of the conversation. Unbounded, this was measurable: recover() visits every
			// historical run and startup grew to about two minutes for a few dozen runs of one long conversation.
			const history = await rt.storage.scanEntries(
				{
					conversationId: entry.conversationId,
					minEntryId: entry.id,
					...(record?.status === "done" ? { maxEntryId: record.answer } : {}),
				},
				Number.MAX_SAFE_INTEGER,
				undefined,
				C,
			);
			const prepared = history.items.find(
				(item) => item.kind === "yonder.prepared" && (item.data as { target?: number })?.target === entry.id,
			);
			if (prepared) data = prepared.data as typeof data;
		}
		const event =
			(data?.event ? await rt.options.readEvent?.(data.event) : undefined) ?? rt.submissions.get(String(id))?.event;
		if (data?.event && !event) throw new Error(`submission ${id} 的来源事件 ${data.event} 不可恢复`);
		if (event)
			events.push(data?.attachments ? { ...event, data: { ...event.data, attachments: data.attachments } } : event);
	}
	return events;
}
export async function receiptRun(
	rt: RuntimeInternals,
	session: string,
	key: string,
	receipt: Readonly<RunReceiptState>,
): Promise<RuntimeRun> {
	const finishKey = `${session}\0${key}`;
	const existing = rt.finishing.get(finishKey);
	if (existing) return existing;
	const promise = (async () => {
		const active = rt.limits.states.get(key);
		active?.visibility.abort();
		clearTimeout(active?.timer);
		try {
			const saved = await rt.harness.snapshot(RunDoc, cid(session), key, C);
			await rt.settleActivity(session, key, receipt, {
				error: saved?.error ?? null,
				reason: saved?.reason ?? null,
			});
			if (!saved?.config || !receipt.settlement)
				throw new Error(`运行 ${session}/${key} 缺少开始配置或终结凭据，历史结果不可确定`);
			const config: RuntimeSessionConfig = JSON.parse(saved.config);
			const usage = sumUsage(receipt.usage);
			for (const field of Object.keys(usage) as Array<keyof typeof usage>) usage[field] -= saved.usageBefore[field];
			const settlement = receipt.settlement;
			const answer =
				settlement.status === "done" ? await rt.harness.commit((tx) => tx.entry(settlement.answer), C) : undefined;
			const inputs = (await rt.sources(receipt.inputs)).map((event) => event.id);
			// Tool results of this run lie between its first input entry and its answer entry. recover() settles every
			// historical receipt, so reading the whole conversation here made startup grow with runs x entries
			// (about two minutes for a few dozen runs of a long conversation).
			const placed = (await Promise.all(receipt.inputs.map((input) => rt.storage.submission(input, C))))
				.map((record) => record?.entry)
				.filter((entry): entry is NonNullable<typeof entry> => entry !== undefined);
			const entries = (saved.toolTasks ?? []).length
				? await rt.storage.scanEntries(
						{
							conversationId: cid(session),
							...(placed.length ? { minEntryId: Math.min(...placed) as (typeof placed)[number] } : {}),
							...(settlement.status === "done" ? { maxEntryId: settlement.answer } : {}),
						},
						Number.MAX_SAFE_INTEGER,
						undefined,
						C,
					)
				: { items: [] };
			const attachments = entries.items.flatMap((entry) =>
				(entry.model ?? []).flatMap((message) =>
					message.role === "toolResult" &&
					entry.byTaskId !== undefined &&
					(saved.toolTasks ?? []).includes(entry.byTaskId)
						? ((message.details as { attachments?: Attachment[] } | undefined)?.attachments ?? [])
						: [],
				),
			);
			const run: RuntimeRun = {
				runId: key,
				session,
				...(attachments.length ? { attachments } : {}),
				config,
				...(answer?.model?.[0]?.role === "assistant"
					? { model: `${answer.model[0].provider}/${answer.model[0].model}` }
					: {}),
				...(saved.error
					? { status: "error" as const, reason: saved.error }
					: submissionOutcome(settlement, saved.reason ?? undefined)),
				text: textOf(answer),
				...(answer?.model?.[0]?.role === "assistant" ? { message: String(answer.model[0].timestamp) } : {}),
				inputs,
				usage,
			};
			if (!(await rt.options.settled?.(session, key))) {
				await rt.options.onUsageSettled?.(session, usage);
				try {
					const attempts = await runAttempts(rt.storage, session, placed, answer?.id);
					await rt.watch.record(config, run, attempts);
				} catch (error) {
					rt.options.onReport?.(error);
				}
				await rt.outbox.note(session, config, run, placed.length ? Math.min(...placed) : undefined);
				await rt.options.onRun?.(session, run);
			}
			await rt.idleChanged(session);
			return run;
		} finally {
			const state = rt.limits.states.get(key);
			if (state) {
				state.visibility.abort();
				clearTimeout(state.timer);
				rt.limits.states.delete(key);
			}
			for (const input of receipt.inputs) rt.submissions.delete(String(input));
			if (rt.configured.get(session) === state?.config) rt.configured.delete(session);
		}
	})();
	rt.finishing.set(finishKey, promise);
	try {
		return await promise;
	} finally {
		rt.finishing.delete(finishKey);
	}
}
/** The existing receipt observer projects only the run actually started by this core. */
export async function settleActivity(
	rt: RuntimeInternals,
	session: string,
	runId: string,
	receipt: Readonly<RunReceiptState>,
	saved: { error: string | null; reason: string | null },
): Promise<void> {
	const end = receipt.settlement;
	if (!end) return;
	// Native continuation remains executable work, not a terminal blocker.
	const pending = await rt.hasPendingWork(session);
	await rt.harness.commit(async (tx) => {
		const state = await tx.doc(SessionDoc, cid(session));
		if (state.activityRunId !== runId) return;
		if (end.status === "done" || (!saved.error && !saved.reason && end.reason === "aborted")) {
			state.activityIssue = null;
			return;
		}
		if (pending || end.status !== "unanswered" || end.reason === "reset") return;
		const code = saved.error
			? "execution_error"
			: saved.reason
				? "runtime_limit"
				: ["model_error", "no_model", "faulted", "orphaned"].includes(end.reason)
					? end.reason
					: "execution_failed";
		state.activityIssue ??= { code, since: Date.now(), runId };
	}, C);
}
// ponytail: scan native receipts; use an upstream lookup if long-session cost becomes measurable.
export async function settledRun(
	rt: RuntimeInternals,
	session: string,
	done: Awaited<ReturnType<Submission["wait"]>>,
): Promise<RuntimeRun> {
	const receipts = await rt.storage.scanDocuments(
		{ scope: { kind: "conversation", conversationId: cid(session) }, kind: "pi.run-receipt", at: "current" },
		Number.MAX_SAFE_INTEGER,
		undefined,
		C,
	);
	for (const doc of receipts.items) {
		const receipt = await rt.harness.snapshot(RunReceiptDoc, cid(session), doc.key!, C);
		if (receipt?.inputs.includes(done.id)) return rt.receiptRun(session, doc.key!, receipt);
	}
	if (done.status === "unanswered" && !done.entry) {
		const source =
			rt.submissions.get(String(done.id))?.event ??
			(done.requestId?.startsWith("event:") ? await rt.options.readEvent?.(done.requestId.slice(6)) : undefined);
		const run: RuntimeRun = {
			runId: `unplaced:${done.id}`,
			...submissionOutcome(done),
			text: "",
			usage: emptyUsage(),
			inputs: source ? [source.id] : [],
		};
		await rt.options.onRun?.(session, run);
		rt.submissions.delete(String(done.id));
		return run;
	}
	throw new Error(`submission ${done.id} 无原生回执，历史运行归属不可确定`);
}
