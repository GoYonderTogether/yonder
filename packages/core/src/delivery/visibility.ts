import type { Channel, Delivery, OutMessage, SessionInfo, YEvent } from "@yonder/sdk";
import type { Binding } from "../config/index.js";
import type { RuntimeSessionConfig } from "../runtime/index.js";
import type { Store } from "../store/index.js";
import type { MessageRequest } from "./index.js";

/** A background completion whose owner never saw output needs one conservative notice. */
export interface CompletionNotice {
	account?: string;
	completion: string;
	to: string;
	text: string;
}

export interface VisibilityDeps {
	store: Store;
	/** Native channel for a ref, or undefined when the ref has no channel or no such plugin. */
	channelFor(ref: string): Channel | undefined;
	lifetime: AbortController;
	streams: Map<string, { visibleAt?: number }>;
	ready: Promise<void>;
	waiting(session: SessionInfo, event: YEvent): boolean | undefined;
	binding(session: SessionInfo, event: YEvent, config: RuntimeSessionConfig): Binding | undefined;
	fromSession(session: SessionInfo): string | undefined;
	send(
		from: string | undefined,
		request: MessageRequest,
		session?: SessionInfo,
		parent?: string,
		config?: RuntimeSessionConfig,
		signal?: AbortSignal,
		runId?: string,
		messageId?: string,
		scope?: { channelInstances?: string[] },
	): Promise<Delivery>;
	attempt(
		target: string,
		method: "send" | "stream",
		session?: string,
		parent?: string,
		runId?: string,
		message?: string,
		outgoing?: OutMessage,
		from?: string,
	): Promise<string | undefined>;
	unknown(id: string, error: unknown, partial?: Delivery): Promise<Delivery>;
	record(
		from: string | undefined,
		target: string,
		msg: OutMessage,
		delivery: Delivery,
		session?: string,
		parent?: string,
		attempt?: string,
		message?: string,
	): Promise<void>;
	report(error: unknown): void;
}

/**
 * Owner visibility for work the model does not narrate: one fallback per background
 * completion, and a heartbeat while an interactive run stays silent.
 */
export function createVisibility(deps: VisibilityDeps) {
	const { store, lifetime, streams, ready } = deps;
	const visible = (event: YEvent) => (event.data as { delivery?: Delivery }).delivery?.ok === true;
	const pendingOrVisible = (events: YEvent[], event: YEvent) =>
		visible(event) ||
		event.type === "message.unknown" ||
		(event.type === "message.attempt" &&
			!events.some(
				(receipt) =>
					receipt.type === "message.out" &&
					(receipt.data as { attempt?: string }).attempt === event.id &&
					!(receipt.data as { delivery: Delivery }).delivery.ok &&
					!(receipt.data as { delivery: Delivery }).delivery.uncertain &&
					!(receipt.data as { delivery: Delivery }).delivery.retryable,
			));
	/** The owner's own message behind a run or a tool result, when the reply may go there. */
	async function ownerSource(
		session: SessionInfo,
		event: YEvent,
		config: RuntimeSessionConfig,
	): Promise<YEvent | undefined> {
		if (deps.waiting(session, event) === true) return;
		let source = event;
		while (["runtime.tool-result", "runtime.continuation"].includes(source.type) && source.parent) {
			const parent = await store.events.get(source.parent);
			if (!parent) return;
			source = parent;
		}
		if (
			!session.agent ||
			source.type !== "message.in" ||
			!source.from ||
			!source.conv ||
			(source.data as { kind?: string }).kind === "agent" ||
			deps.waiting(session, source) !== false ||
			!deps.channelFor(source.conv) ||
			(deps.binding(session, source, config)?.reply ?? "auto") !== "auto"
		)
			return;
		if ((await store.identity().relation(session.agent, source.from)) !== "owner") return;
		return source;
	}
	async function complete(session: SessionInfo, notices: CompletionNotice[], config?: RuntimeSessionConfig) {
		for (const notice of notices) {
			const outputs = await store.events.outputSince(session.id, notice.to, notice.completion, "", notice.account);
			// An in-flight/unknown message may already be visible. Never send a speculative duplicate.
			if (outputs.some((event) => pendingOrVisible(outputs, event))) continue;
			await deps.send(
				deps.fromSession(session),
				{ to: notice.to, text: notice.text },
				session,
				notice.completion,
				config,
				AbortSignal.any([lifetime.signal, AbortSignal.timeout(60000)]),
				`completion:${notice.completion}`,
				"fallback",
			);
		}
	}
	/** One notice per background completion that produced no owner-visible output. */
	async function notices(session: SessionInfo, events: YEvent[], config: RuntimeSessionConfig) {
		const found: CompletionNotice[] = [];
		for (const event of events.filter((candidate) => candidate.type === "runtime.tool-result")) {
			const source = await ownerSource(session, event, config);
			if (!source) continue;
			const data = event.data as { tool?: string; text?: string; status?: string };
			const statusLine = data.text?.match(/(?:^|[\n"\\])STATUS: (done|partial|blocked|unknown)\b/u)?.[1];
			const confirmed =
				data.status === "done" &&
				(statusLine ? statusLine === "done" : data.tool !== "task_run" && data.tool !== "agent_ask");
			const status =
				data.status !== "done"
					? (data.status ?? "unknown")
					: (statusLine ?? (["task_run", "agent_ask"].includes(data.tool ?? "") ? "unknown" : "done"));
			const title = Array.from(
				((source.data as { text?: string }).text ?? data.tool ?? "task").replace(/[\r\n\u2028\u2029]/gu, " "),
			)
				.slice(0, 40)
				.join("");
			found.push({
				completion: event.id,
				...((source.data as { kind?: string }).kind === "dm" && source.from ? { account: source.from } : {}),
				to: source.conv!,
				text: confirmed ? `✅ 后台任务「${title}」已完成。` : `⚠️ 后台任务「${title}」未能确认完成（${status}）。`,
			});
		}
		return found;
	}
	/** Deterministic silence beat for an interactive run; never a model request. */
	async function heartbeat(
		session: SessionInfo,
		run: {
			runId: string;
			started: number;
			tools: number;
			lastToolAt?: number;
			config: RuntimeSessionConfig;
			signal?: AbortSignal;
			inputs: YEvent[];
		},
		interval = 300000,
	): Promise<number | undefined> {
		const first = run.inputs[0];
		if (!first || first.type !== "message.in" || !(await ownerSource(session, first, run.config))) return;
		if (run.signal?.aborted || lifetime.signal.aborted) return;
		const target = first.conv!;
		const outputs = await store.events.outputSince(
			session.id,
			target,
			"",
			new Date(run.started).toISOString(),
			(first.data as { kind?: string }).kind === "dm" ? first.from : undefined,
		);
		const beats = outputs.filter(
			(event) =>
				event.type === "message.attempt" && (event.data as { runId?: string }).runId === `heartbeat:${run.runId}`,
		);
		const stuckAt =
			Math.max(run.started, run.lastToolAt ?? run.started) + run.config.resolved.limits.stuckMinutes * 60000;
		const stuck = Date.now() >= stuckAt;
		if (beats.some((event) => (event.data as { message?: string }).message === "heartbeat:stuck")) return;
		if (beats.length >= 6 && !stuck) return Math.max(1, stuckAt - Date.now());
		const latest = outputs.filter((event) => pendingOrVisible(outputs, event)).at(-1);
		// Native stream deltas can be visible before the final delivery receipt.
		const streamTime = Math.max(
			0,
			...[...streams]
				.filter(([key]) => key.startsWith(`${session.id}\0${run.runId}\0`))
				.map(([, state]) => state.visibleAt ?? 0),
		);
		const remaining = Math.max(latest ? Date.parse(latest.ts) : run.started, streamTime) + interval - Date.now();
		if (remaining > 0) return remaining;
		const minutes = Math.floor((Date.now() - run.started) / 60000);
		const duration = minutes >= 60 ? `约 ${Math.round(minutes / 60)} 小时` : `${minutes} 分钟`;
		const text = stuck
			? `⚠️ 任务疑似卡住（已 ${duration}，长时间没有新工具调用）。可发送 /stop 停止，或继续等待。`
			: `⏳ 仍在处理（已 ${duration}，已执行 ${run.tools} 次工具）。`;
		const channel = deps.channelFor(target);
		const receipt = outputs.find(
			(event) =>
				event.type === "message.out" &&
				(event.data as { message?: string }).message === "heartbeat:1" &&
				beats.some((attempt) => attempt.id === (event.data as { attempt?: string }).attempt) &&
				(event.data as { delivery?: Delivery }).delivery?.ok,
		);
		const messageId = (receipt?.data as { delivery?: Delivery } | undefined)?.delivery?.id;
		const key = stuck ? "heartbeat:stuck" : `heartbeat:${beats.length + 1}`;
		if (run.signal?.aborted || lifetime.signal.aborted) return;
		const signal = AbortSignal.any([lifetime.signal, ...(run.signal ? [run.signal] : []), AbortSignal.timeout(60000)]);
		if (channel?.edit && messageId) {
			const id = await deps.attempt(
				target,
				"send",
				session.id,
				first.id,
				`heartbeat:${run.runId}`,
				key,
				{ text },
				deps.fromSession(session),
			);
			if (id) {
				try {
					const result = await channel.edit(target, messageId, { text }, signal);
					if (result.uncertain) await deps.unknown(id, result.error ?? "edit outcome unknown", result);
					else await deps.record(deps.fromSession(session), target, { text }, result, session.id, first.id, id, key);
				} catch (error) {
					await deps.unknown(id, error);
				}
			}
		} else
			await deps.send(
				deps.fromSession(session),
				{ to: target, text },
				session,
				first.id,
				run.config,
				signal,
				`heartbeat:${run.runId}`,
				key,
			);
		return stuck ? undefined : interval;
	}
	/** Restart replays only notices with no attempt yet; the ledger decides, not this loop. */
	async function replay() {
		for (const event of await store.events.completionNotices()) {
			const data = event.data as { session: string; completionNotices: CompletionNotice[] };
			const session = await store.sessions.get(data.session);
			if (session)
				void (async () => {
					await ready;
					if (!lifetime.signal.aborted) await complete(session, data.completionNotices);
				})().catch(deps.report);
		}
	}
	return { complete, heartbeat, notices, replay };
}
