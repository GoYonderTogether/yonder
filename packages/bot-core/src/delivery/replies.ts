import type { MessageRequest } from "@yonder/bot-core/delivery/index";
import type { Binding } from "@yonder/bot-definition";
import { allowsChannelInstance, CONSOLE } from "@yonder/bot-definition/console";
import type { Runtime, RuntimeRun, RuntimeSessionConfig } from "@yonder/runtime-adapter/types";
import type { Channel, EventInput, OutputPart, RunEndData, SessionInfo, YEvent } from "@yonder/sdk";
import type { Sessions } from "../sessions/index.js";
import type { Store } from "../store/contracts.js";
import { cloudFailure } from "./cloud-result.js";
import type { createLedger } from "./ledger.js";
import { sourceMessage, stopNotice } from "./model-notice.js";
import { OutputQueue, ReplyText } from "./reply-text.js";
import type { createSender } from "./send.js";
import { channelId, type DeliveryOptions, message, type StreamEntry, selectedHooks } from "./shared.js";
import type { createReplyGuard } from "./social-guard.js";
import { guardStream } from "./social-guard.js";
import type { createVisibility } from "./visibility.js";

type Ledger = ReturnType<typeof createLedger>;
type Visibility = ReturnType<typeof createVisibility>;

/** Stream assembly and run completion: how model output becomes deliveries and one run.end ending. */
export function createReplies({
	options,
	store,
	sessions,
	channels,
	hooks,
	ledger,
	checkReply,
	send,
	prepare,
	sendPrepared,
	streams,
	ready,
	binding,
	waiting,
	visibility,
	report,
	fromSession: from,
	retry,
}: {
	options: DeliveryOptions;
	store: Store;
	sessions: Sessions;
	channels: Map<string, Channel>;
	hooks: DeliveryOptions["hooks"];
	ledger: Ledger;
	checkReply: ReturnType<typeof createReplyGuard>;
	send: ReturnType<typeof createSender>["send"];
	prepare: ReturnType<typeof createSender>["prepare"];
	sendPrepared: ReturnType<typeof createSender>["sendPrepared"];
	streams: Map<string, StreamEntry>;
	ready: Promise<void>;
	binding(session: SessionInfo, event: YEvent, config?: RuntimeSessionConfig): Binding | undefined;
	waiting(session: SessionInfo, event: YEvent): boolean | undefined;
	visibility: Visibility;
	report: (error: unknown) => void;
	fromSession: (session: SessionInfo) => string | undefined;
	retry: (event: YEvent) => void;
}) {
	const delivering = new Set<Promise<void>>();
	const { attempt, record, unknown } = ledger;
	const runtimeRef = options.runtime as () => Runtime;
	const selected = (config?: RuntimeSessionConfig) => selectedHooks(hooks, config);

	function closeMessage(session: SessionInfo, state: StreamEntry, text: string) {
		const stream = state.current;
		if (!stream) return;
		state.current = undefined;
		if (!stream.delivery) return;
		state.lastMessage = state.message;
		stream.queue.push({ type: "final", text });
		stream.queue.end();
		const messageId = state.message;
		state.tail = (async () => {
			const delivered = await stream.delivery!;
			if (!delivered.uncertain)
				await record(
					from(session),
					stream.target,
					{ text, ...(stream.sourceMessageId ? { sourceMessageId: stream.sourceMessageId } : {}) },
					delivered,
					session.id,
					state.owner,
					stream.attempt,
					messageId,
				);
			if (!delivered.ok && delivered.retryable && !delivered.id && !delivered.uncertain)
				for (const event of await store.events.retryableAttempts()) retry(event);
		})().catch(report);
	}

	function onStart(
		session: SessionInfo,
		event: YEvent,
		waiter: boolean,
	): ((part: OutputPart, runId?: string) => void) | undefined {
		const target = event.conv,
			sourceMessageId = sourceMessage(event);
		if (waiter || !target) return;
		return (part, runId) => {
			if (!runId || part.type === "final") return;
			const config = runtimeRef().currentConfig(session.id);
			if (!config || !allowsChannelInstance(config.resolved, channelId(target) ?? "")) return;
			const binding_ = binding(session, event, config);
			const channel = channels.get(channelId(target) ?? "");
			if (!binding_?.stream || (binding_.reply ?? "auto") !== "auto" || !channel?.output.stream || !channel.stream)
				return;
			if (selected(config).length && part.type !== "message_start" && part.type !== "message_end") return;
			const key = `${session.id}\0${runId}\0${target}`;
			let state = streams.get(key);
			if (state && state.owner !== event.id) return;
			if (!state) {
				state = { owner: event.id, tail: Promise.resolve() };
				streams.set(key, state);
			}
			if (part.type === "message_start") {
				if (state.current) closeMessage(session, state, state.current.text);
				state.message = part.id;
				return;
			}
			if (part.type === "message_end") {
				if (!state.current?.delivery && part.text.trim() && part.text.trim() !== "NO_REPLY") {
					// An ordinary short message can still be a prefix of NO_REPLY until its end.
					const previous = state.tail,
						messageId = state.message,
						text = part.text;
					state.current = undefined;
					state.lastMessage = messageId;
					state.tail = (async () => {
						await ready;
						await previous;
						await send(
							from(session),
							{ to: target, text, ...(sourceMessageId ? { sourceMessageId } : {}) },
							session,
							event.id,
							config,
							AbortSignal.timeout(60000),
							runId,
							messageId,
						);
					})().catch(report);
				} else closeMessage(session, state, part.text.trim() === "NO_REPLY" ? "" : part.text);
				return;
			}
			if (part.type !== "text" && !state.current) return;
			if (!state.current) {
				state.current = {
					target,
					...(sourceMessageId ? { sourceMessageId } : {}),
					queue: new OutputQueue(),
					gate: new ReplyText(),
					text: "",
				};
			}
			const stream = state.current;
			if (part.type === "text") {
				const delta = stream.gate.push(part.delta);
				if (!delta) return;
				stream.text += delta;
				state.visibleAt = Date.now();
				part = { type: "text", delta };
			}
			if (!stream.delivery) {
				const previous = state.tail,
					messageId = state.message;
				stream.delivery = (async () => {
					await ready;
					await previous;
					try {
						await checkReply(session.id, target, event.id);
					} catch (error) {
						return { ok: false, error: message(error) };
					}
					const id = await attempt(target, "stream", session.id, event.id, runId, messageId);
					if (!id) return { ok: false, uncertain: true, error: "该消息已有渠道尝试，不自动重新开流" };
					stream.attempt = id;
					try {
						const delivered = await channel.stream!(
							target,
							guardStream(stream.queue, () => checkReply(session.id, target, event.id)),
							sourceMessage(event),
						);
						return !delivered.ok && delivered.uncertain
							? unknown(id, delivered.error ?? "渠道未确认结果", delivered)
							: delivered;
					} catch (error) {
						return unknown(id, error);
					}
				})();
			}
			stream.queue.push(part);
		};
	}
	async function onRun(session: SessionInfo, run: RuntimeRun, inputs: YEvent[], _waiter = false) {
		const profile = run.config ?? (await sessions.resolveSession(session.id));
		const actual = inputs.length
			? inputs
			: (await Promise.all(run.inputs.map((id) => store.events.get(id)))).filter((event): event is YEvent => !!event);
		const first = actual[0];
		for (const event of actual)
			if (waiting(session, event) === undefined)
				report(new Error(`输入 ${event.id} 缺少历史 waiting，自动投递不可确定，未发送`));
		const singleResult = (event: YEvent) => channels.get(channelId(event.conv!) ?? "")?.output.singleResult === true;
		const sources = [
			...new Map(
				actual
					.filter(
						(event) =>
							waiting(session, event) === false &&
							event.conv &&
							channels.has(channelId(event.conv) ?? "") &&
							((binding(session, event, profile)?.reply ?? "auto") === "auto" || singleResult(event)),
					)
					.map((event) => [event.conv, event]),
			).values(),
		];
		const hasWaiter = actual.some((event) => waiting(session, event) === true);
		const stopped = run.status !== "done";
		if (stopped)
			options.log?.("warn", "Run stopped; channel got a category notice", {
				session,
				status: run.status,
				reason: run.reason,
			});
		const finalText = stopped ? stopNotice(run.reason ?? run.status) : run.text.trim() === "NO_REPLY" ? "" : run.text;
		// The console is the owner's main dialogue: a run that carries a console input answers there only, never in the
		// channel conversations whose pending inputs the same run merged (BUG01). Other runs keep every source.
		// conv-less inputs (a subtask or advisor consult the model started) belong to no channel and to no console turn.
		const onConsole = (event: YEvent) => !!event.conv && channelId(event.conv) === CONSOLE;
		const consoleTurn = actual.some(onConsole);
		const replies = consoleTurn ? sources.filter(onConsole) : sources;
		const prefix = `${session.id}\0${run.runId}\0`;
		const owned = [...streams].filter(([key]) => key.startsWith(prefix));
		const prepared = new Map<YEvent, MessageRequest>();
		const targets: YEvent[] = [];
		for (const event of replies) {
			const sourceMessageId = sourceMessage(event);
			const failure = singleResult(event)
				? stopped
					? cloudFailure(run.reason ?? run.status)
					: binding(session, event, profile)?.reply === "none"
						? "本轮来源关闭自动回复，未投递模型回复"
						: undefined
				: undefined;
			const request: MessageRequest = {
				to: event.conv!,
				text: failure ?? finalText,
				...(failure ? { content: { type: "error", text: failure } } : {}),
				...(sourceMessageId ? { sourceMessageId } : {}),
			};
			const state = owned.find(([key]) => key.endsWith(`\0${event.conv}`))?.[1];
			const streamed =
				!stopped && state && ((state.lastMessage && state.lastMessage === run.message) || !state.message);
			const outgoing = streamed
				? request
				: await prepare(request, session, profile, {
						runId: run.runId,
						status: run.status,
						sourceEventId: event.id,
					});
			const empty = !outgoing.content && (!outgoing.text.trim() || outgoing.text.trim() === "NO_REPLY");
			if (!stopped && empty && !singleResult(event)) continue;
			if (!stopped && empty) {
				const text = cloudFailure("模型返回空回答");
				outgoing.text = text;
				outgoing.content = { type: "error", text };
			}
			prepared.set(event, outgoing);
			targets.push(event);
		}
		const destination =
			!stopped &&
			!consoleTurn &&
			!targets.length &&
			!hasWaiter &&
			run.text.trim() &&
			run.text.trim() !== "NO_REPLY" &&
			first
				? binding(session, first, profile)?.deliver
				: undefined;
		const replied: RunEndData["replied"] = targets.length
			? "source"
			: hasWaiter
				? "caller"
				: destination
					? "deliver"
					: "none";
		const completionNotices = await visibility.notices(session, actual, profile);
		const ending: EventInput & { data: { session: string; runId: string; [key: string]: unknown } } = {
			type: "run.end",
			...(from(session) ? { from: from(session)! } : {}),
			...(first ? { parent: first.id } : {}),
			...(first?.conv ? { conv: first.conv } : {}),
			data: {
				session: session.id,
				runId: run.runId,
				inputs: run.inputs,
				...(completionNotices.length ? { completionNotices } : {}),
				status: run.status,
				...(run.reason ? { reason: run.reason } : {}),
				replied,
				model: run.model ?? profile.resolved.model,
				thinking: profile.resolved.thinking,
				...(profile.effort ? { effort: profile.effort } : {}),
				usage: run.usage,
				targets: targets.map((event) => event.conv),
				...(destination ? { deliver: destination } : {}),
			},
		};
		for (const [key] of owned) streams.delete(key);
		// Model termination is durable and its slot released before awaiting any channel.
		const deliver = () => {
			const pending = (async () => {
				await ready;
				for (const [, state] of owned)
					if (state.current) closeMessage(session, state, state.message ? state.current.text : finalText);
				for (const event of targets) {
					const state = owned.find(([key]) => key.endsWith(`\0${event.conv}`))?.[1];
					if (state) await state.tail;
					if (!stopped && state?.lastMessage && state.lastMessage === run.message) continue;
					if (!stopped && state && !state.message) continue;
					await sendPrepared(
						from(session),
						prepared.get(event)!,
						session,
						event.id,
						profile,
						AbortSignal.timeout(60000),
						run.runId,
						stopped ? undefined : run.message,
					);
				}
				if (destination)
					await send(
						from(session),
						{ ...destination, text: run.text },
						session,
						first?.id,
						profile,
						AbortSignal.timeout(60000),
						run.runId,
						stopped ? undefined : run.message,
					);
				await Promise.all(owned.map(([, state]) => state.tail));
				await visibility.complete(session, completionNotices, profile);
			})().catch(report);
			delivering.add(pending);
			void pending.then(() => delivering.delete(pending));
		};
		return { ending, deliver };
	}
	return { closeMessage, onStart, onRun, close: () => Promise.all(delivering) };
}
