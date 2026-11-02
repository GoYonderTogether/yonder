import type { Runtime, RuntimeSessionConfig } from "@yonder/runtime-adapter/types";
import type { Delivery, SessionInfo, ToolContext, YEvent } from "@yonder/sdk";
import { createLedger } from "./ledger.js";
import { sourceMessage } from "./model-notice.js";
import { createReplies } from "./replies.js";
import type { MessageRequest } from "./request.js";
import { createSender } from "./send.js";
import { bindingFor, channelId, type DeliveryOptions, fromSession, type StreamEntry, waiting } from "./shared.js";
import { createReplyGuard } from "./social-guard.js";
import { createTargetResolver } from "./target.js";
import { createToolSend } from "./tool-send.js";
import { createVisibility } from "./visibility.js";

export { sourceMessage, stopNotice } from "./model-notice.js";
export { ReplyText } from "./reply-text.js";
export type { MessageRequest } from "./request.js";
export type { DeliveryOptions } from "./shared.js";

export function createDelivery(options: DeliveryOptions) {
	const { store, agents, channels, sessions } = options;
	const ledger = createLedger(store);
	const streams = new Map<string, StreamEntry>();
	const report = options.onReport ?? (() => {});
	const lifetime = new AbortController();
	const retries = new Map<string, Promise<void>>();
	let start!: () => void;
	const ready = new Promise<void>((resolve) => {
		start = resolve;
	});
	const binding = bindingFor(agents);
	const resolveTarget = createTargetResolver({ store, agents, channels });
	const checkReply = createReplyGuard({
		sessions,
		agents,
		store,
		channels,
		...(options.participationHooks ? { participationHooks: options.participationHooks } : {}),
	});
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
		send: (from, request, session, parent, config, signal, runId, messageId, scope) =>
			sender.send(from, request, session, parent, config, signal, runId, messageId, scope),
		attempt: ledger.attempt,
		unknown: ledger.unknown,
		record: ledger.record,
		report,
	});
	const sender = createSender({
		options,
		agents,
		channels,
		hooks: options.hooks,
		sessions,
		store,
		ledger,
		checkReply,
		resolveTarget,
		lifetime,
		ready,
		retries,
		report,
	});
	const { send, proactive, retry } = sender;
	const replies = createReplies({
		options,
		store,
		sessions,
		channels,
		hooks: options.hooks,
		ledger,
		checkReply,
		send,
		prepare: sender.prepare,
		sendPrepared: sender.sendPrepared,
		streams,
		ready,
		binding,
		waiting,
		visibility,
		report,
		fromSession,
		retry,
	});
	const sendTool = createToolSend({ store, runtime: options.runtime as () => Runtime, resolveTarget, proactive });
	return {
		heartbeat: visibility.heartbeat,
		modelNotice: visibility.modelNotice,
		onStart: replies.onStart,
		onRun: replies.onRun,
		start,
		async close() {
			lifetime.abort();
			start();
			await Promise.all(retries.values());
			await visibility.close();
		},
		async recover() {
			for (const event of await store.events.unresolvedAttempts())
				await ledger.unknown(event.id, new Error("进程在渠道尝试后未保存确认"));
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
		resolveTarget,
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
			return sendTool(ctx, request);
		},
	};
}
export type DeliveryService = ReturnType<typeof createDelivery>;
