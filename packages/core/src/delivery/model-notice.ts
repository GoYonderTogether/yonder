import type { YEvent } from "@yonder/sdk";
import type { ModelFallbackEvent } from "../runtime/types.js";
import type { Sessions } from "../sessions/index.js";
import type { VisibilityDeps } from "./visibility.js";

export function sourceMessage(event: YEvent): string | undefined {
	const data = event.data as { msgId?: string; originals?: Array<{ messageId?: string; msgId?: string }> };
	const original = data.originals?.at(-1);
	return original?.messageId ?? original?.msgId ?? data.msgId;
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
							(deps.binding(session, input, config)?.reply ?? "auto") === "auto",
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
