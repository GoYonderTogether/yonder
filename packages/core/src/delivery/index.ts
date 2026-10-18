import {
	type Attachment,
	type Channel,
	type Delivery,
	type OutMessage,
	type OutputPart,
	parseRef,
	type RunEndData,
	type SessionInfo,
	type ToolContext,
	type YEvent,
} from "@yonder/sdk";
import type { AgentConfig, Binding } from "../config/index.js";
import type { Runtime, RuntimeRun } from "../runtime/index.js";
import type { Sessions } from "../sessions/index.js";
import type { Store } from "../store/index.js";

export interface MessageRequest {
	to: string;
	via?: string;
	text: string;
	attachments?: Attachment[];
}
interface DeliveryOptions {
	store: Store;
	agents: Map<string, AgentConfig>;
	channels: Map<string, Channel>;
	runtime: () => Runtime;
	sessions: Sessions;
	onReport?: (error: unknown) => void;
}

/** Hold only the prefix that may still be the model's control marker. */
export class ReplyText {
	private pending = "";
	private released = false;
	push(delta: string): string {
		if (this.released) return delta;
		this.pending += delta;
		if ("NO_REPLY".startsWith(this.pending.trimStart()) || this.pending.trim() === "NO_REPLY") return "";
		this.released = true;
		const text = this.pending;
		this.pending = "";
		return text;
	}
}
class OutputQueue implements AsyncIterable<OutputPart> {
	private pending: OutputPart[] = [];
	private wake: (() => void) | undefined;
	private ended = false;
	push(part: OutputPart) {
		if (this.ended) return;
		this.pending.push(part);
		this.wake?.();
		this.wake = undefined;
	}
	end() {
		this.ended = true;
		this.wake?.();
		this.wake = undefined;
	}
	async *[Symbol.asyncIterator](): AsyncIterator<OutputPart> {
		while (true) {
			while (this.pending.length) yield this.pending.shift() as OutputPart;
			if (this.ended) return;
			await new Promise<void>((resolve) => {
				this.wake = resolve;
			});
		}
	}
}
interface StreamState {
	event: YEvent;
	target: string;
	channel: Channel;
	queue: OutputQueue;
	gate: ReplyText;
	delivery?: Promise<Delivery>;
}
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
const channelId = (ref: string) => {
	const parsed = parseRef(ref);
	return parsed.kind === "acct" || parsed.kind === "conv" ? parsed.channel : undefined;
};
const fromSession = (session: SessionInfo) => (session.agent ? `agent:${session.agent}` : undefined);

export function createDelivery(options: DeliveryOptions) {
	const { store, agents, channels, sessions } = options;
	const completed = new Set<string>();
	const streams = new Map<string, StreamState>();
	const active = new Map<string, string>();
	const binding = (session: SessionInfo, event: YEvent): Binding | undefined => {
		const route = event.routes?.find((route) => route.agent === session.agent && route.session === session.id);
		return session.agent
			? agents.get(session.agent)?.bindings.find((binding) => binding.id === route?.binding)
			: undefined;
	};
	const sourceEvents = (session: SessionInfo, events: YEvent[]) => {
		const seen = new Set<string>();
		return events.filter((event) => {
			if (
				!event.conv ||
				!channels.has(channelId(event.conv) ?? "") ||
				(binding(session, event)?.reply ?? "auto") !== "auto" ||
				seen.has(event.conv)
			)
				return false;
			seen.add(event.conv);
			return true;
		});
	};
	async function record(
		from: string | undefined,
		target: string,
		msg: OutMessage,
		delivery: Delivery,
		session?: string,
		parent?: string,
	) {
		await store.events.record({
			type: "message.out",
			...(from ? { from } : {}),
			...(target.startsWith("conv:") ? { conv: target } : {}),
			...(parent ? { parent } : {}),
			data: {
				text: msg.text,
				...(msg.attachments ? { attachments: msg.attachments } : {}),
				...(session ? { session } : {}),
				...(target === "owner" ? {} : { to: target }),
				delivery,
			},
		});
	}
	async function resolveTarget(
		request: MessageRequest,
		agent?: string | null,
	): Promise<{ target: string; channel: Channel }> {
		let target = request.to;
		if (target === "owner") {
			if (!agent) throw new Error("预设会话没有 owner；请指定 person:、acct: 或 conv: 目标。");
			const owner = agents.get(agent)?.owner;
			if (!owner) throw new Error(`Agent ${agent} 没有 owner`);
			target = owner;
		}
		let parsed = parseRef(target);
		if (parsed.kind === "person") {
			const person = await store.identity().person(target);
			const accounts = person ? await Promise.all(person.accounts.map((ref) => store.identity().account(ref))) : [];
			const selected = accounts
				.filter((account) => account && (!request.via || channelId(account.ref) === request.via))
				.sort((a, b) => (b?.lastSeen ?? "").localeCompare(a?.lastSeen ?? ""))[0];
			if (!selected) throw new Error("此人没有符合渠道要求的账号；请先关联账号。");
			target = selected.ref;
			parsed = parseRef(target);
		}
		if (parsed.kind !== "acct" && parsed.kind !== "conv") throw new Error("目标必须为 person:、acct: 或 conv: 引用。");
		if (request.via && parsed.channel !== request.via) throw new Error("via 与目标引用的渠道不一致。");
		const channel = channels.get(parsed.channel);
		if (!channel) throw new Error(`渠道未运行：${parsed.channel}`);
		return { target, channel };
	}
	async function send(
		from: string | undefined,
		request: MessageRequest,
		session?: SessionInfo,
		parent?: string,
	): Promise<Delivery> {
		let target = request.to,
			delivery: Delivery;
		try {
			const resolved = await resolveTarget(request, session?.agent);
			target = resolved.target;
			delivery = await resolved.channel.send(target, {
				text: request.text,
				...(request.attachments ? { attachments: request.attachments } : {}),
			});
		} catch (error) {
			delivery = { ok: false, error: message(error) };
		}
		await record(
			from,
			target,
			{ text: request.text, ...(request.attachments ? { attachments: request.attachments } : {}) },
			delivery,
			session?.id,
			parent,
		);
		return delivery;
	}
	function onStart(session: SessionInfo, event: YEvent, waiter: boolean): ((part: OutputPart) => void) | undefined {
		const key = `${session.id}\0${event.id}`;
		if (!active.has(session.id)) active.set(session.id, key);
		const selected = binding(session, event),
			target = event.conv;
		if (waiter || !target || !selected?.stream || (selected.reply ?? "auto") !== "auto") return;
		const channel = channels.get(channelId(target) ?? "");
		if (!channel?.output.stream || !channel.stream) return;
		const state: StreamState = { event, target, channel, queue: new OutputQueue(), gate: new ReplyText() };
		streams.set(key, state);
		return (part) => {
			const current = active.get(session.id);
			if (current && current !== key) return;
			if (part.type === "final") return;
			if (part.type === "text") {
				const delta = state.gate.push(part.delta);
				if (!delta) return;
				part = { type: "text", delta };
			}
			if (!state.delivery) {
				active.set(session.id, key);
				state.delivery = Promise.resolve()
					.then(
						() =>
							channel.stream?.(target, state.queue, (event.data as { msgId?: string }).msgId) ?? {
								ok: false,
								error: "渠道不支持流式",
							},
					)
					.catch((error) => ({ ok: false, error: message(error) }));
			}
			state.queue.push(part);
		};
	}
	async function onRun(session: SessionInfo, run: RuntimeRun, inputs: YEvent[], waiter: boolean): Promise<void> {
		const runKey = `${session.id}\0${run.runId}`;
		if (completed.has(runKey)) return;
		completed.add(runKey);
		const actualInputs = inputs.length
			? inputs
			: (await Promise.all(run.inputs.map((id) => store.events.get(id)))).filter((event): event is YEvent => !!event);
		const first = actualInputs[0],
			sources = sourceEvents(session, actualInputs),
			firstBinding = first ? binding(session, first) : undefined;
		let replied: RunEndData["replied"] = "none";
		const text = run.text.trim();
		let targets: YEvent[] = [];
		let finalText = run.text;
		if (run.status === "limit" || run.status === "error") {
			finalText = `运行已停止：${run.reason ?? run.status}。`;
			targets = sources;
			replied = targets.length ? "source" : "none";
		} else if (text && text !== "NO_REPLY") {
			if (waiter) replied = "caller";
			else if (sources.length) {
				targets = sources;
				replied = "source";
			} else if (firstBinding?.deliver) {
				replied = "deliver";
				await send(
					fromSession(session),
					{
						to: firstBinding.deliver.to,
						text: run.text,
						...(firstBinding.deliver.via ? { via: firstBinding.deliver.via } : {}),
					},
					session,
					first?.id,
				);
			}
		}
		const streamKeys = actualInputs.map((event) => `${session.id}\0${event.id}`);
		// Release the session slot before awaiting a channel; the next queued run may already produce output.
		if (streamKeys.includes(active.get(session.id) ?? "")) active.delete(session.id);
		for (const event of targets) {
			const key = `${session.id}\0${event.id}`,
				state = streams.get(key);
			const replyTo = (event.data as { msgId?: string }).msgId;
			if (state && event.id === first?.id) {
				state.delivery ??= Promise.resolve()
					.then(
						() => state.channel.stream?.(state.target, state.queue, replyTo) ?? { ok: false, error: "渠道不支持流式" },
					)
					.catch((error) => ({ ok: false, error: message(error) }));
				state.queue.push({ type: "final", text: finalText });
			} else {
				const target = event.conv;
				if (!target) continue;
				const channel = channels.get(channelId(target) ?? "");
				if (!channel) continue;
				let delivery: Delivery;
				try {
					delivery = await channel.send(target, { text: finalText, ...(replyTo ? { replyTo } : {}) });
				} catch (error) {
					delivery = { ok: false, error: message(error) };
				}
				await record(fromSession(session), target, { text: finalText }, delivery, session.id, first?.id);
			}
		}
		for (const key of streamKeys) {
			const state = streams.get(key);
			streams.delete(key);
			if (!state) continue;
			state.queue.end();
			if (state.delivery) {
				const delivered = await state.delivery;
				await record(
					fromSession(session),
					state.target,
					{ text: targets.some((event) => event.conv === state.target) ? finalText : "" },
					delivered,
					session.id,
					first?.id,
				);
			}
		}
		const profile = await sessions.resolveSession(session.id);
		await store.events.record({
			type: "run.end",
			...(fromSession(session) ? { from: fromSession(session) as string } : {}),
			...(first ? { parent: first.id } : {}),
			...(first?.conv ? { conv: first.conv } : {}),
			data: {
				session: session.id,
				inputs: run.inputs.length ? run.inputs : actualInputs.map((event) => event.id),
				status: run.status,
				...(run.reason ? { reason: run.reason } : {}),
				replied,
				model: profile.resolved.model,
				usage: run.usage,
			},
		});
	}
	return {
		onStart,
		onRun,
		async sendPlugin(pluginId: string, request: MessageRequest): Promise<Delivery> {
			if (request.to === "owner") return { ok: false, error: "插件必须使用显式 person:、acct: 或 conv: 目标。" };
			return send(`plugin:${pluginId}`, request);
		},
		async sendTool(ctx: ToolContext, request: MessageRequest): Promise<Delivery> {
			const session = await store.sessions.get(ctx.session);
			if (!session) throw new Error("当前会话不存在。");
			let target: string;
			try {
				target = (await resolveTarget(request, ctx.agent)).target;
			} catch (error) {
				return { ok: false, error: message(error) };
			}
			if (target !== ctx.event?.conv && !ctx.capabilities.includes("message"))
				return { ok: false, error: "发往本次运行来源以外需要 message 能力。" };
			return send(fromSession(session), request, session, ctx.event?.id);
		},
	};
}
export type DeliveryService = ReturnType<typeof createDelivery>;
