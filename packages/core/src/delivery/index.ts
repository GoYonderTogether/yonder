import { setTimeout as sleep } from "node:timers/promises";
import {
	type Attachment,
	type Channel,
	type Delivery,
	type EventInput,
	type Hook,
	type OutMessage,
	type OutputPart,
	parseRef,
	type RunEndData,
	type SessionInfo,
	type ToolContext,
	type YEvent,
} from "@yonder/sdk";
import type { AgentConfig, Binding } from "../config/index.js";
import { allowsChannelInstance, assertChannelInstance } from "../kernel/console.js";
import type { Runtime, RuntimeRun, RuntimeSessionConfig } from "../runtime/index.js";
import type { Sessions } from "../sessions/index.js";
import type { Store } from "../store/index.js";
import { consoleAllowed, persistConsole, type Scope } from "./console.js";
import { createLedger } from "./ledger.js";
import { sourceMessage } from "./model-notice.js";
import { OutputQueue, ReplyText } from "./reply-text.js";
import { createReplyGuard, guardStream } from "./social-guard.js";

export { ReplyText } from "./reply-text.js";

import { createVisibility } from "./visibility.js";

export { sourceMessage };
export interface MessageRequest {
	to: string;
	via?: string;
	text: string;
	replyTo?: string;
	sourceMessageId?: string;
	attachments?: Attachment[];
	signal?: AbortSignal;
}
interface DeliveryOptions {
	hooks?: Map<string, Hook[]>;
	store: Store;
	agents: Map<string, AgentConfig>;
	channels: Map<string, Channel>;
	runtime: () => Runtime;
	sessions: Sessions;
	onReport?: (error: unknown) => void;
	log?: (level: "info" | "warn" | "error", message: string, data?: object) => void;
}
interface StreamState extends Pick<MessageRequest, "sourceMessageId"> {
	target: string;
	queue: OutputQueue;
	gate: ReplyText;
	delivery?: Promise<Delivery>;
	text: string;
	attempt?: string;
}
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
const channelId = (ref: string) => {
	const parsed = parseRef(ref);
	return parsed.kind === "acct" || parsed.kind === "conv" ? parsed.channel : undefined;
};
/**
 * What the person sees when a run stops: a safe category and what to do next, in Chinese. The raw reason (provider
 * text, URLs, internal codes) is never sent to a channel; it stays in the log and in the `run.end` event.
 */
export function stopNotice(reason: string): string {
	if (/connection error|fetch failed|ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket|network/i.test(reason))
		return "网络连接中断，这一轮没有完成。网络恢复后回我一句，我接着做。";
	// A run that never got an answer must say so: the model chain is the one failure the person cannot see from the
	// channel side, and silence reads as "Jarvis is ignoring me" (G1 §6.6 tier 3).
	if (/^(model_error|no_model)\b/i.test(reason)) {
		if (/\b(401|403)\b|unauthori[sz]ed|forbidden|invalid[ _-]?api[ _-]?key|authentication|credential/i.test(reason))
			return "模型账号验证失败，这一轮没有完成。请管理员检查模型凭据后再回我一句。";
		if (/\b429\b|rate[ _-]?limit|quota|too many requests|insufficient|billing/i.test(reason))
			return "模型请求太频繁或额度用完，这一轮没有完成。过一会儿回我一句，我重试；持续出现请管理员检查额度。";
		if (/timed? ?out|timeout/i.test(reason)) return "模型响应超时，这一轮没有完成。过一会儿回我一句，我重试。";
		if (/\b5\d\d\b|overloaded|unavailable/i.test(reason))
			return "模型服务暂时不可用，这一轮没有完成。过一会儿回我一句，我重试。";
		return "模型都不可用（model_error），这一轮没有完成。过一会儿回我一句，我重试；持续出现请管理员查看日志。";
	}
	return "运行已停止，这一轮没有完成。回我一句我可以重新开始；反复出现请管理员查看日志。";
}
const fromSession = (session: SessionInfo) => (session.agent ? `agent:${session.agent}` : undefined);
export function createDelivery(options: DeliveryOptions) {
	const { store, agents, channels, sessions } = options;
	const { attempt, record, unknown } = createLedger(store);
	const streams = new Map<
		string,
		{
			owner: string;
			message?: string;
			lastMessage?: string | undefined;
			visibleAt?: number;
			current?: StreamState | undefined;
			tail: Promise<void>;
		}
	>();
	const selectedHooks = (config?: RuntimeSessionConfig) =>
		(config?.resolved.plugins ?? []).flatMap((id) => options.hooks?.get(id) ?? []).filter((hook) => !!hook.beforeSend);
	const report = options.onReport ?? (() => {});
	const lifetime = new AbortController();
	const retries = new Map<string, Promise<void>>();
	let start!: () => void;
	const ready = new Promise<void>((resolve) => {
		start = resolve;
	});
	const binding = (session: SessionInfo, event: YEvent, config?: RuntimeSessionConfig): Binding | undefined => {
		const route = event.routes?.find((route) => route.session === session.id && route.agent === session.agent);
		return session.agent
			? (config?.bindings ?? agents.get(session.agent)?.bindings)?.find((binding) => binding.id === route?.binding)
			: undefined;
	};
	const waiting = (session: SessionInfo, event: YEvent) =>
		event.routes?.find((route) => route.session === session.id)?.waiting ??
		(event.data as { waiting?: boolean }).waiting;
	const visibility = createVisibility({
		store,
		sessions,
		proactiveNotificationsEnabled: (agent) => agents.get(agent)?.social?.enabled === true,
		channelFor: (ref) => channels.get(channelId(ref) ?? ""),
		lifetime,
		streams,
		ready,
		waiting,
		binding,
		fromSession,
		send,
		attempt,
		unknown,
		record,
		report,
	});
	async function resolveTarget(
		request: MessageRequest,
		agent?: string | null,
		config?: RuntimeSessionConfig,
		scope: Scope = config?.resolved ?? {},
	): Promise<{ target: string; channel: Channel }> {
		if (request.via) assertChannelInstance(scope, request.via);
		let target = request.to;
		if (target === "owner") {
			if (!agent) throw new Error("预设会话没有 owner；请指定明确目标。");
			const owner = config ? config.owner : agents.get(agent)?.owner;
			if (!owner) throw new Error(`Agent ${agent} 没有 owner`);
			target = owner;
		}
		let parsed = parseRef(target);
		if (parsed.kind === "person") {
			const person = await store.identity().person(target);
			const accounts = person ? await Promise.all(person.accounts.map((ref) => store.identity().account(ref))) : [];
			const selected = accounts
				.filter(
					(account) =>
						account &&
						consoleAllowed(account.ref, scope) &&
						allowsChannelInstance(scope, channelId(account.ref) ?? "") &&
						(!request.via || channelId(account.ref) === request.via),
				)
				.sort((a, b) => (b?.lastSeen ?? "").localeCompare(a?.lastSeen ?? ""))[0];
			if (!selected) throw new Error("此人没有符合渠道要求的账号；请先关联账号。");
			target = selected.ref;
			parsed = parseRef(target);
		}
		if (parsed.kind !== "acct" && parsed.kind !== "conv") throw new Error("目标必须为 person:、acct: 或 conv: 引用。");
		if (request.via && parsed.channel !== request.via) throw new Error("via 与目标引用的渠道不一致。");
		assertChannelInstance(scope, parsed.channel);
		const channel = channels.get(parsed.channel);
		if (!channel) throw new Error(`渠道未运行：${parsed.channel}`);
		return { target, channel };
	}
	const checkReply = createReplyGuard({ sessions, agents, store, channels });
	async function send(
		from: string | undefined,
		request: MessageRequest,
		session?: SessionInfo,
		parent?: string,
		config?: RuntimeSessionConfig,
		signal: AbortSignal = AbortSignal.timeout(60000),
		runId?: string,
		messageId?: string,
		scope: Scope = config?.resolved ?? {},
	): Promise<Delivery> {
		for (const hook of selectedHooks(config)) {
			const changed = await hook.beforeSend?.(
				request,
				session ? { session: session.id, agent: session.agent, profile: session.profile } : undefined,
			);
			if (changed) request = { ...request, ...changed.message };
		}
		let resolved: Awaited<ReturnType<typeof resolveTarget>>;
		try {
			resolved = await resolveTarget(request, session?.agent, config, scope);
			if (session) await checkReply(session.id, resolved.target, parent);
		} catch (error) {
			const delivery = { ok: false, error: message(error) };
			const { signal: _signal, ...outgoing } = request;
			await record(from, request.to, outgoing, delivery, session?.id, parent);
			return delivery;
		}
		const { signal: _signal, ...outgoing } = request;
		const id = await attempt(resolved.target, "send", session?.id, parent, runId, messageId, outgoing, from);
		if (!id) return { ok: false, error: "该消息/目标已有发送尝试，结果以持久确认或 unknown 为准，不自动重发" };
		let delivery: Delivery;
		try {
			delivery = await resolved.channel.send(resolved.target, { ...outgoing, deliveryId: id }, signal);
		} catch (error) {
			return unknown(id, error);
		}
		if (scope.proactive) delivery = await persistConsole(options, resolved, outgoing, id, session, delivery);
		if (!delivery.ok && (delivery.uncertain || delivery.id))
			return unknown(id, delivery.error ?? "渠道未确认结果", delivery);
		await record(from, resolved.target, outgoing, delivery, session?.id, parent, id, messageId);
		if (!delivery.ok && delivery.retryable && !delivery.id && !delivery.uncertain) {
			const event = await store.events.get(id);
			if (event) retry(event);
		}
		return delivery;
	}
	const proactive = (
		from: string | undefined,
		msg: MessageRequest,
		session: SessionInfo | undefined,
		config: RuntimeSessionConfig | undefined,
		signal: AbortSignal | undefined,
		scope: Scope = config?.resolved ?? {},
	) => send(from, msg, session, scope.event?.id, config, signal, undefined, undefined, { ...scope, proactive: true });
	// The existing attempt ledger owns retry facts; timers only drive unresolved safe sends.
	function retry(event: YEvent) {
		if (retries.has(event.id) || lifetime.signal.aborted) return;
		const data = event.data as {
			target: string;
			outgoing: OutMessage;
			from?: string;
			session?: string;
			message?: string;
		};
		const work = (async () => {
			await ready;
			let delay = 1000;
			while (!lifetime.signal.aborted) {
				await sleep(delay, undefined, { signal: lifetime.signal, ref: false });
				if (data.session) {
					try {
						const config = await sessions.resolveSession(data.session);
						assertChannelInstance(config.resolved, channelId(data.target) ?? "");
						await checkReply(data.session, data.target, event.parent);
						if (data.from?.startsWith("plugin:") && !config.resolved.capabilities.includes("message"))
							throw new Error("Program delivery requires current message capability");
					} catch (error) {
						await record(
							data.from,
							data.target,
							data.outgoing,
							{ ok: false, error: message(error) },
							data.session,
							event.parent,
							event.id,
							data.message,
						);
						return;
					}
				}
				const channel = channels.get(channelId(data.target) ?? "");
				if (!channel) return;
				await store.events.record({ type: "message.retry", data: { attempt: event.id } });
				let result: Delivery;
				try {
					result = await channel.send(
						data.target,
						{ ...data.outgoing, deliveryId: event.id },
						AbortSignal.any([lifetime.signal, AbortSignal.timeout(60000)]),
					);
				} catch (error) {
					if (lifetime.signal.aborted) return;
					await unknown(event.id, error);
					return;
				}
				if (lifetime.signal.aborted) return;
				if (result.uncertain || (!result.ok && result.id)) {
					await unknown(event.id, result.error ?? "渠道未确认结果", result);
					return;
				}
				await record(data.from, data.target, data.outgoing, result, data.session, event.parent, event.id, data.message);
				if (result.ok || !result.retryable) return;
				delay = Math.min(delay * 2, 30000);
			}
		})()
			.catch((error) => {
				if (!lifetime.signal.aborted) report(error);
			})
			.finally(() => retries.delete(event.id));
		retries.set(event.id, work);
	}
	function closeMessage(session: SessionInfo, state: NonNullable<ReturnType<typeof streams.get>>, text: string) {
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
					fromSession(session),
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
			const config = options.runtime().currentConfig(session.id);
			if (!config || !allowsChannelInstance(config.resolved, channelId(target) ?? "")) return;
			const selected = binding(session, event, config);
			const channel = channels.get(channelId(target) ?? "");
			if (!selected?.stream || (selected.reply ?? "auto") !== "auto" || !channel?.output.stream || !channel.stream)
				return;
			if (selectedHooks(config).length && part.type !== "message_start" && part.type !== "message_end") return;
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
							fromSession(session),
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
		const sources = [
			...new Map(
				actual
					.filter(
						(event) =>
							waiting(session, event) === false &&
							event.conv &&
							channels.has(channelId(event.conv) ?? "") &&
							(binding(session, event, profile)?.reply ?? "auto") === "auto",
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
		const targets = stopped || (run.text.trim() && run.text.trim() !== "NO_REPLY") ? sources : [];
		const destination =
			!stopped && !targets.length && !hasWaiter && run.text.trim() && run.text.trim() !== "NO_REPLY" && first
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
			...(fromSession(session) ? { from: fromSession(session)! } : {}),
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
		const prefix = `${session.id}\0${run.runId}\0`;
		const owned = [...streams].filter(([key]) => key.startsWith(prefix));
		for (const [key] of owned) streams.delete(key);
		// Model termination is durable and its slot released before awaiting any channel.
		const deliver = () => {
			void (async () => {
				await ready;
				for (const [, state] of owned)
					if (state.current) closeMessage(session, state, state.message ? state.current.text : finalText);
				for (const event of targets) {
					const sourceMessageId = sourceMessage(event);
					const state = owned.find(([key]) => key.endsWith(`\0${event.conv}`))?.[1];
					if (state) await state.tail;
					if (!stopped && state?.lastMessage && state.lastMessage === run.message) continue;
					if (!stopped && state && !state.message) continue;
					await send(
						fromSession(session),
						{
							to: event.conv!,
							text: finalText,
							...(sourceMessageId ? { sourceMessageId } : {}),
						},
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
						fromSession(session),
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
		};
		return { ending, deliver };
	}
	return {
		heartbeat: visibility.heartbeat,
		modelNotice: visibility.modelNotice,
		onStart,
		onRun,
		start,
		async close() {
			lifetime.abort();
			start();
			await Promise.all(retries.values());
			await visibility.close();
		},
		async recover() {
			for (const event of await store.events.unresolvedAttempts())
				await unknown(event.id, new Error("进程在渠道尝试后未保存确认"));
			for (const event of await store.events.retryableAttempts()) retry(event);
			await visibility.replay();
		},
		async sendCommand(session: SessionInfo, event: YEvent, text: string): Promise<Delivery> {
			if (!event.conv) throw new Error("Command has no source conversation");
			const sourceMessageId = sourceMessage(event);
			return send(
				fromSession(session),
				{ to: event.conv, text, ...(sourceMessageId ? { sourceMessageId } : {}) },
				session,
				event.id,
				await sessions.resolveSession(session.id),
				AbortSignal.timeout(60000),
				`command:${event.id}`,
			);
		},
		async sendPlugin(pluginId: string, request: MessageRequest): Promise<Delivery> {
			if (request.to === "owner") return { ok: false, error: "插件必须使用显式 person:、acct: 或 conv: 目标。" };
			return proactive(`plugin:${pluginId}`, request, undefined, undefined, request.signal);
		},
		async sendOwned(
			pluginId: string,
			request: MessageRequest,
			config: RuntimeSessionConfig,
			session: SessionInfo,
		): Promise<Delivery> {
			if (!config.resolved.capabilities.includes("message"))
				return { ok: false, error: "Program delivery requires current message capability" };
			return proactive(`plugin:${pluginId}`, request, session, config, request.signal);
		},
		async sendTool(ctx: ToolContext, request: MessageRequest): Promise<Delivery> {
			const session = await store.sessions.get(ctx.session);
			if (!session) throw new Error("当前会话不存在。");
			const config = options.runtime().currentConfig(ctx.session);
			let target: string;
			try {
				target = (await resolveTarget(request, ctx.agent, config, ctx)).target;
			} catch (error) {
				return { ok: false, error: message(error) };
			}
			try {
				await options.runtime().authorizeAttachments(ctx, request.attachments);
			} catch (error) {
				return { ok: false, error: message(error) };
			}
			if (
				!(ctx.events ?? (ctx.event ? [ctx.event] : [])).some((event) => event.conv === target) &&
				!ctx.capabilities.includes("message")
			)
				return { ok: false, error: "发往本次运行来源以外需要 message 能力。" };
			if (request.replyTo) {
				let after: string | undefined;
				let found = false;
				do {
					const page = await store.events.query({
						type: "message.in",
						...(target.startsWith("conv:") ? { conv: target } : { from: target }),
						limit: 1000,
						...(after ? { after } : {}),
					});
					found = page.events.some((event) => {
						const data = event.data as {
							kind?: string;
							msgId?: string;
							originals?: Array<{ msgId?: string; messageId?: string }>;
						};
						if (event.conv !== target && data.kind !== "dm") return false;
						const native = sourceMessage(event);
						if (event.id === request.replyTo && native) {
							request = { ...request, replyTo: native };
							return true;
						}
						return (
							data.msgId === request.replyTo ||
							data.originals?.some((item) => (item.messageId ?? item.msgId) === request.replyTo) === true
						);
					});
					after = page.next;
				} while (!found && after);
				if (!found) return { ok: false, error: "replyTo 不是该目标会话已接收的真实消息 ID。" };
			}
			return proactive(fromSession(session), request, session, config, ctx.signal, ctx);
		},
	};
}
export type DeliveryService = ReturnType<typeof createDelivery>;
