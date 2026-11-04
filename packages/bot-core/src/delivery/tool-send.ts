import type { MessageRequest } from "@yonder/bot-core/delivery/index";
import type { Runtime, RuntimeSessionConfig } from "@yonder/runtime-adapter/types";
import type { Channel, Delivery, SessionInfo, ToolContext } from "@yonder/sdk";
import type { Store } from "../store/contracts.js";
import type { Scope } from "./console.js";
import { sourceMessage } from "./model-notice.js";
import { fromSession, message } from "./shared.js";

/** Everything a tool's `message.send` needs: runtime checks, reply binding and the final proactive send. */
export interface ToolSendDeps {
	store: Store;
	runtime: () => Runtime;
	resolveTarget: (
		request: Pick<MessageRequest, "to" | "via">,
		agent?: string | null,
		config?: RuntimeSessionConfig,
		scope?: Scope,
	) => Promise<{ target: string; channel: Channel }>;
	proactive: (
		from: string | undefined,
		msg: MessageRequest,
		session: SessionInfo | undefined,
		config: RuntimeSessionConfig | undefined,
		signal: AbortSignal | undefined,
		scope?: Scope,
	) => Promise<Delivery>;
}

export function createToolSend({ store, runtime, resolveTarget, proactive }: ToolSendDeps) {
	return async function sendTool(ctx: ToolContext, request: MessageRequest): Promise<Delivery> {
		const session = await store.sessions.get(ctx.session);
		if (!session) throw new Error("当前会话不存在。");
		const config = runtime().currentConfig(ctx.session);
		let target: string;
		let singleResult = false;
		try {
			const resolved = await resolveTarget(request, ctx.agent, config, ctx);
			target = resolved.target;
			singleResult = resolved.channel.output.singleResult === true;
		} catch (error) {
			return { ok: false, error: message(error) };
		}
		if (
			singleResult &&
			(ctx.events ?? (ctx.event ? [ctx.event] : [])).some(
				(event) => event.conv === target || ((event.data as { kind?: string }).kind === "dm" && event.from === target),
			)
		)
			return { ok: false, error: "本渠道只投递本轮最终结果，不支持对本轮来源即时发送；请把内容放最终回复。" };
		try {
			await runtime().authorizeAttachments(ctx, request.attachments);
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
			if (!found)
				return {
					ok: false,
					error:
						"replyTo 不是该目标会话已接收的真实消息 ID。跨会话通知时，请在下一次调用中省略 respondTo 和 replyTo；不要挪用其他会话的消息 ID。原始来源仍由本次运行的 sources 保留。",
				};
		}
		if (!request.respondTo && !request.replyTo && !request.sourceMessageId) {
			const inputs = ctx.events ?? (ctx.event ? [ctx.event] : []);
			const candidates = inputs.filter((event) => event.type === "message.in" && event.conv === target);
			for (const input of inputs) {
				if (input.type !== "channel-qq.group-batch" || input.conv !== target) continue;
				const ids = (input.data as { sourceEvents?: unknown }).sourceEvents;
				if (!Array.isArray(ids)) continue;
				for (const id of ids) {
					if (typeof id !== "string") continue;
					const event = await store.events.get(id);
					if (event?.type === "message.in" && event.conv === target) candidates.push(event);
				}
			}
			const source = candidates.sort((a, b) => b.id.localeCompare(a.id)).find((event) => sourceMessage(event));
			const native = source && sourceMessage(source);
			if (native) request = { ...request, sourceMessageId: native };
		}
		return proactive(fromSession(session), request, session, config, ctx.signal, ctx);
	};
}
