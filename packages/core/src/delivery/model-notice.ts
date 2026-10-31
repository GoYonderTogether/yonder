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

/** 详情最多保留的字符数：够看清是哪个错误，又不至于把整段供应商响应搬进聊天。 */
const DETAIL_LIMIT = 160;

/**
 * 供应商错误里可能夹着凭据：密钥、Bearer 头、长串 token。详情行要能读，但绝不能带出这些值。
 * 只做字符串级遮蔽，不改写错误本身的含义。值只在确实像凭据时才遮蔽：键名后面跟普通单词（
 * “token request failed”）原样保留，否则详情会读不通。
 */
export function redactError(text: string): string {
	return text
		.replace(/\b(sk|pk|rk)-[A-Za-z0-9_-]{6,}/gi, "[密钥]")
		.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{6,}/gi, "Bearer [密钥]")
		.replace(
			/\b(?:x-api-key|api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|password)["']?\s*[:=]\s*["']?([^\s"',;}]+)/gi,
			(m, value: string) => (value.length >= 8 && /[0-9]/.test(value) ? m.replace(value, "[密钥]") : m),
		)
		.replace(/\b[A-Fa-f0-9]{32,}\b/g, "[密钥]")
		.replace(/\b[A-Za-z0-9_-]{40,}\b/g, "[长串]");
}

/** 模型链耗尽时，外层包装只说明“试过了”，真正的原因在里面。 */
function innerCause(reason: string): string {
	return reason
		.replace(/^(?:model_error|no_model)\s*:?\s*/i, "")
		.replace(/^Model (?:fallback chain|retries) exhausted \([^)]*\)\s*:?\s*/i, "")
		.trim();
}

/** 取一段能看出问题、又不含凭据和内部地址的详情。 */
function detailOf(reason: string): string | undefined {
	const cause = innerCause(reason);
	if (!cause) return undefined;
	const cleaned = redactError(cause)
		.replace(/https?:\/\/[^\s"']+/gi, (url) => {
			try {
				const parsed = new URL(url);
				return `${parsed.protocol}//${parsed.host}/…`;
			} catch {
				return "[地址]";
			}
		})
		.replace(/\s+/g, " ")
		.trim();
	if (!cleaned) return undefined;
	return cleaned.length > DETAIL_LIMIT ? `${cleaned.slice(0, DETAIL_LIMIT)}…` : cleaned;
}

/**
 * 一次运行停下来时给人的提示。它是系统的说明，不是 Bot 说的话，所以统一带系统标记和独立的三行结构；
 * 模型失败时附一段截断并遮蔽过的真实原因，让人一眼看出为什么，而不用去翻日志。
 */
export function stopNotice(reason: string): string {
	const notice = (summary: string, action: string, detail?: string) =>
		[`【系统】${summary}`, ...(detail ? [`详情：${detail}`] : []), `处理：${action}`].join("\n");
	const detail = detailOf(reason);
	if (/connection error|fetch failed|ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket|network/i.test(reason))
		return notice("网络连接中断，这一轮没有完成。", "网络恢复后回我一句，我接着做。", detail);
	// A run that never got an answer must say so: the model chain is the one failure the person cannot see from the
	// channel side, and silence reads as "Jarvis is ignoring me" (G1 §6.6 tier 3).
	if (/^(model_error|no_model)\b/i.test(reason)) {
		// 顺序有讲究：额度池耗尽的文案里也带 “daily token limit”，请求过大的文案里也带 “limit”，
		// 所以先判真正更具体的 413 与请求体超限，再判额度、鉴权。
		if (/\b413\b|payload too large|request too large|request body|too many tokens|maximum context/i.test(reason))
			return notice(
				"这一轮要发给模型的内容超出了上限，所以没有发出去。会话历史太大时，压缩也可能因为同一上限失败。",
				"缩小范围后回我一句，我重做；历史太大时先开新会话。",
				detail,
			);
		if (
			/rate[ _-]?limit|quota|too many requests|insufficient|billing|usage limit|no usable account|cooling down/i.test(
				reason,
			)
		)
			return notice(
				"模型请求太频繁或额度用完，这一轮没有完成。",
				"过一会儿回我一句，我重试；持续出现请管理员检查额度。",
				detail,
			);
		if (
			/\b(401|403)\b|unauthori[sz]ed|forbidden|invalid[ _-]?api[ _-]?key|authentication|credential|oauth|invalid_grant/i.test(
				reason,
			)
		)
			return notice("模型账号验证失败，这一轮没有完成。", "请管理员检查模型凭据后再回我一句。", detail);
		if (/\b429\b/i.test(reason))
			return notice(
				"模型请求太频繁或额度用完，这一轮没有完成。",
				"过一会儿回我一句，我重试；持续出现请管理员检查额度。",
				detail,
			);
		if (/context.{0,12}(?:length|window|limit)|token.{0,12}limit/i.test(reason))
			return notice("这一轮要发给模型的内容超出了上限，所以没有发出去。", "缩小范围后回我一句，我重做。", detail);
		if (/timed? ?out|timeout/i.test(reason))
			return notice("模型响应超时，这一轮没有完成。", "过一会儿回我一句，我重试。", detail);
		if (/\b5\d\d\b|overloaded|unavailable/i.test(reason))
			return notice("模型服务暂时不可用，这一轮没有完成。", "过一会儿回我一句，我重试。", detail);
		return notice("模型链没有跑通，这一轮没有完成。", "过一会儿回我一句，我重试；持续出现请管理员查看日志。", detail);
	}
	return notice("运行已停止，这一轮没有完成。", "回我一句我可以重新开始；反复出现请管理员查看日志。", detail);
}
