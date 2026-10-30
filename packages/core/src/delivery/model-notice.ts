import type { YEvent } from "@yonder/sdk";
import type { Binding } from "../config/index.js";
import type { ModelFallbackEvent } from "../runtime/types.js";
import type { Sessions } from "../sessions/index.js";
import type { VisibilityDeps } from "./visibility.js";

export function sourceMessage(event: YEvent): string | undefined {
	const data = event.data as { msgId?: string; originals?: Array<{ messageId?: string; msgId?: string }> };
	const original = data.originals?.at(-1);
	return original?.messageId ?? original?.msgId ?? data.msgId;
}

/** card 渠道上不含 owner 的绑定即名片访客：回退提示只给主人看，不发给访客（JV2-J04-02）。 */
function visitorBinding(binding: Binding | undefined): boolean {
	if (!binding) return false;
	const channels = [binding.match.channel ?? []].flat();
	const from = [binding.match.from ?? []].flat();
	return channels.some((id) => id === "card" || id.startsWith("card-")) && !from.includes("owner");
}

export function createModelNotice(
	deps: Pick<
		VisibilityDeps,
		"store" | "channelFor" | "lifetime" | "ready" | "waiting" | "binding" | "fromSession" | "send" | "report"
	> & {
		sessions: Sessions;
	},
) {
	const { store, sessions, lifetime, ready, report } = deps;
	const notices = new Set<Promise<void>>();
	function send(event: ModelFallbackEvent) {
		if (!event.inputs?.length) return;
		const pending = (async () => {
			await ready;
			if (lifetime.signal.aborted) return;
			const session = await store.sessions.get(event.session);
			if (!session) return;
			const config = await sessions.resolveSession(session.id);
			const inputs = (await Promise.all(event.inputs!.map((id) => store.events.get(id)))).filter(
				(input): input is YEvent => !!input,
			);
			const sources = new Map(
				inputs
					.filter(
						(input) =>
							deps.waiting(session, input) === false &&
							input.conv &&
							deps.channelFor(input.conv) &&
							(deps.binding(session, input, config)?.reply ?? "auto") === "auto" &&
							!visitorBinding(deps.binding(session, input, config)),
					)
					.map((input) => [input.conv!, input]),
			);
			for (const [to, input] of sources) {
				const sourceMessageId = sourceMessage(input);
				await deps.send(
					deps.fromSession(session),
					{
						to,
						text:
							event.state === "fallback" ? "首选模型暂不可用，已切换到备用模型。" : "首选模型已恢复，已切回首选模型。",
						...(sourceMessageId ? { sourceMessageId } : {}),
					},
					session,
					input.id,
					config,
					AbortSignal.any([lifetime.signal, AbortSignal.timeout(60000)]),
					`model:${event.state}:${event.inputs![0]}`,
				);
			}
		})().catch(report);
		notices.add(pending);
		void pending.finally(() => notices.delete(pending));
	}
	return {
		send,
		async close() {
			await Promise.all(notices);
		},
		async replay() {
			let after: string | undefined;
			do {
				const page = await store.events.query({ type: "model.fallback", limit: 1000, ...(after ? { after } : {}) });
				for (const event of page.events) send(event.data as ModelFallbackEvent);
				after = page.next;
			} while (after);
		},
	};
}

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
