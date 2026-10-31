import { setTimeout as sleep } from "node:timers/promises";
import {
	type Channel,
	type Delivery,
	type Hook,
	type OutMessage,
	parseRef,
	type SessionInfo,
	type YEvent,
} from "@yonder/sdk";
import { assertChannelInstance } from "../config/console.js";
import type { AgentConfig } from "../config/index.js";
import type { RuntimeSessionConfig } from "../runtime/index.js";
import type { Sessions } from "../sessions/index.js";
import type { Store } from "../store/index.js";
import { persistConsole, type Scope } from "./console.js";
import type { createLedger } from "./ledger.js";
import { sourceMessage } from "./model-notice.js";
import type { MessageRequest } from "./request.js";
import { channelId, type DeliveryOptions, message, selectedHooks } from "./shared.js";
import type { createReplyGuard } from "./social-guard.js";

type Ledger = ReturnType<typeof createLedger>;

export interface SenderDeps {
	options: DeliveryOptions;
	agents: Map<string, AgentConfig>;
	channels: Map<string, Channel>;
	hooks: Map<string, Hook[]> | undefined;
	sessions: Sessions;
	store: Store;
	ledger: Ledger;
	checkReply: ReturnType<typeof createReplyGuard>;
	resolveTarget: (
		request: Pick<MessageRequest, "to" | "via">,
		agent?: string | null,
		config?: RuntimeSessionConfig,
		scope?: Scope,
	) => Promise<{ target: string; channel: Channel }>;
	lifetime: AbortController;
	ready: Promise<void>;
	retries: Map<string, Promise<void>>;
	report: (error: unknown) => void;
}

/** Send, retry and console persistence for one delivery service: routing and validation stay in target.ts. */
export function createSender(deps: SenderDeps) {
	const { options, sessions, store, ledger, checkReply, resolveTarget, lifetime, retries, report } = deps;
	const { attempt, record, unknown } = ledger;
	const hooks = deps.hooks;

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
		for (const hook of selectedHooks(hooks, config)) {
			const changed = await hook.beforeSend?.(
				request,
				session ? { session: session.id, agent: session.agent, profile: session.profile } : undefined,
			);
			if (changed) request = { ...request, ...changed.message };
		}
		let resolved: Awaited<ReturnType<typeof resolveTarget>>;
		try {
			resolved = await resolveTarget(request, session?.agent, config, scope);
			if (request.respondTo) {
				const event = await store.events.get(request.respondTo);
				const source = event && sourceMessage(event);
				if (event?.type !== "message.in" || event.conv !== resolved.target || !source)
					throw new Error("respondTo 不是该目标会话已接收的真实入站事件 ID。");
				request = { ...request, sourceMessageId: source };
			}
			if (request.mentions?.length) {
				if (!resolved.channel.features?.outboundMentions) throw new Error("该渠道不支持真实账号艾特。");
				if (!resolved.target.startsWith("conv:")) throw new Error("艾特需要明确的目标会话。");
				for (const ref of request.mentions) {
					const account = parseRef(ref);
					if (account.kind !== "acct" || account.channel !== channelId(resolved.target))
						throw new Error("艾特目标必须是当前渠道的账号。");
					const seen = await store.events.query({ type: "message.in", conv: resolved.target, from: ref, limit: 1 });
					if (!seen.events.length) throw new Error("艾特目标不是该会话已观察到的成员。");
				}
			}
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
			await deps.ready;
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
				const channel = deps.channels.get(channelId(data.target) ?? "");
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
	return { send, proactive, retry };
}
