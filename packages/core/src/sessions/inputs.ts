import type { Attachment, RunResult, SessionInfo, YEvent } from "@yonder/sdk";
import type { Runtime } from "../runtime/index.js";
import type { Store } from "../store/index.js";

export async function recoverSessionInputs(
	store: Store,
	runtime: () => Runtime,
	submitTaskEvent: (session: SessionInfo, event: YEvent) => Promise<RunResult>,
	onReport: (error: unknown) => void,
): Promise<Array<() => void>> {
	const pending: Array<() => void> = [];
	let after: string | undefined;
	do {
		const page = await store.events.query({ type: "session.input", limit: 1000, ...(after ? { after } : {}) });
		for (const event of page.events) {
			const data = event.data as { session?: string; waiting?: boolean; busy?: string; taskOwned?: boolean };
			if (
				!data.session ||
				data.taskOwned ||
				(await store.events.runForInput(data.session, event.id)) ||
				(await runtime().admitted(data.session, event.id))
			)
				continue;
			const session = await store.sessions.get(data.session);
			if (!session || session.closed || data.waiting === undefined || data.busy === undefined) {
				onReport(new Error(`预设输入 ${event.id} 缺少可恢复接纳信息，不猜测重交`));
				continue;
			}
			pending.push(() => {
				void submitTaskEvent(session, event).catch(onReport);
			});
		}
		after = page.next;
	} while (after);
	return pending;
}

export async function notifySession(
	store: Store,
	runtime: () => Runtime,
	closing: Set<string>,
	id: string,
	input: { event: string; text: string; attachments?: Attachment[] },
	from: string,
) {
	if (!from.trim()) throw new Error("Notification requires a program source");
	if (!from.trim()) throw new Error("Notification requires a program source");
	if (!input.event || typeof input.text !== "string") throw new Error("Notification requires an event and text");
	const session = await store.sessions.get(id);
	if (!session || session.closed || closing.has(id)) throw new Error(`Not an open session: ${id}`);
	const source = await store.events.get(input.event);
	if (!source) throw new Error(`Unknown notification event: ${input.event}`);
	// 06 §2：只带附件的消息正文为空也是完整消息；附件记在该消息事件上。
	const attachments =
		input.attachments ?? (source.data as { attachments?: Attachment[] } | undefined)?.attachments ?? [];
	if (!input.text.trim() && !attachments.length)
		throw new Error("Notification requires an event and text or an attachment");
	return runtime().notify(id, { ...input, from, ...(attachments.length ? { attachments } : {}) });
}
