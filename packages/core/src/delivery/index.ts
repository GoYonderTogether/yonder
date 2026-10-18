import {
	type Attachment,
	type Channel,
	type Delivery,
	type EventInput,
	type OutMessage,
	type OutputPart,
	parseRef,
	type RunEndData,
	type SessionInfo,
	type ToolContext,
	type YEvent,
} from "@yonder/sdk";
import type { AgentConfig, Binding } from "../config/index.js";
import type { Runtime, RuntimeRun, RuntimeSessionConfig } from "../runtime/index.js";
import type { Sessions } from "../sessions/index.js";
import type { Store } from "../store/index.js";

export interface MessageRequest {
	to: string;
	via?: string;
	text: string;
	attachments?: Attachment[];
	signal?: AbortSignal;
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
	target: string;
	channel: Channel;
	queue: OutputQueue;
	gate: ReplyText;
	signal: AbortSignal;
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
	const streams = new Map<string, StreamState & { owner: string; attempt?: string }>();
	const report = options.onReport ?? (() => {});
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
	async function record(
		from: string | undefined,
		target: string,
		msg: OutMessage,
		delivery: Delivery,
		session?: string,
		parent?: string,
		attempt?: string,
	) {
		await store.events.record({
			type: "message.out",
			...(from ? { from } : {}),
			...(target.startsWith("conv:") ? { conv: target } : {}),
			...(parent ? { parent } : {}),
			data: { ...msg, ...(session ? { session } : {}), to: target, delivery, ...(attempt ? { attempt } : {}) },
		});
	}
	async function resolveTarget(
		request: MessageRequest,
		agent?: string | null,
		config?: RuntimeSessionConfig,
	): Promise<{ target: string; channel: Channel }> {
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
	async function attempt(
		target: string,
		method: "send" | "stream",
		session?: string,
		parent?: string,
		runId?: string,
	): Promise<string | undefined> {
		return store.events.claimAttempt({
			type: "message.attempt",
			...(parent ? { parent } : {}),
			...(target.startsWith("conv:") ? { conv: target } : {}),
			data: { target, method, ...(session ? { session } : {}), ...(runId ? { runId } : {}) },
		});
	}
	async function unknown(id: string, error: unknown, partial?: Delivery): Promise<Delivery> {
		await store.events.record({
			type: "message.unknown",
			data: { attempt: id, reason: message(error), ...(partial?.id ? { id: partial.id } : {}) },
		});
		return { ...partial, ok: false, uncertain: true, error: `发送结果未知：${message(error)}；不会自动重发` };
	}
	async function send(
		from: string | undefined,
		request: MessageRequest,
		session?: SessionInfo,
		parent?: string,
		config?: RuntimeSessionConfig,
		signal: AbortSignal = AbortSignal.timeout(60000),
		runId?: string,
	): Promise<Delivery> {
		let resolved: Awaited<ReturnType<typeof resolveTarget>>;
		try {
			resolved = await resolveTarget(request, session?.agent, config);
		} catch (error) {
			const delivery = { ok: false, error: message(error) };
			const { signal: _signal, ...outgoing } = request;
			await record(from, request.to, outgoing, delivery, session?.id, parent);
			return delivery;
		}
		const id = await attempt(resolved.target, "send", session?.id, parent, runId);
		if (!id) return { ok: false, error: "该运行/目标已有发送尝试，结果以持久确认或 unknown 为准，不自动重发" };
		let delivery: Delivery;
		const { signal: _signal, ...outgoing } = request;
		try {
			delivery = await resolved.channel.send(resolved.target, outgoing, signal);
		} catch (error) {
			return unknown(id, error);
		}
		if (!delivery.ok && delivery.uncertain) return unknown(id, delivery.error ?? "渠道未确认结果", delivery);
		await record(from, resolved.target, outgoing, delivery, session?.id, parent, id);
		return delivery;
	}
	function onStart(
		session: SessionInfo,
		event: YEvent,
		waiter: boolean,
	): ((part: OutputPart, runId?: string) => void) | undefined {
		const target = event.conv;
		if (waiter || !target) return;
		return (part, runId) => {
			if (!runId || part.type === "final") return;
			const config = options.runtime().currentConfig(session.id);
			if (!config) return;
			const selected = binding(session, event, config);
			const channel = channels.get(channelId(target) ?? "");
			if (!selected?.stream || (selected.reply ?? "auto") !== "auto" || !channel?.output.stream || !channel.stream)
				return;
			const key = `${session.id}\0${runId}\0${target}`;
			let state = streams.get(key);
			if (state && state.owner !== event.id) return;
			if (!state) {
				state = {
					owner: event.id,
					target,
					channel,
					queue: new OutputQueue(),
					gate: new ReplyText(),
					signal: AbortSignal.timeout(Math.ceil(config.resolved.limits.maxMinutes * 60000) + 60000),
				};
				streams.set(key, state);
			}
			if (part.type === "text") {
				const delta = state.gate.push(part.delta);
				if (!delta) return;
				part = { type: "text", delta };
			}
			if (!state.delivery) {
				const stream = state;
				state.delivery = (async () => {
					await ready;
					const id = await attempt(target, "stream", session.id, event.id, runId);
					if (!id) return { ok: false, uncertain: true, error: "该运行已有渠道尝试，不自动重新开流" };
					stream.attempt = id;
					try {
						const delivered = await channel.stream!(
							target,
							stream.queue,
							(event.data as { msgId?: string }).msgId,
							stream.signal,
						);
						return !delivered.ok && delivered.uncertain
							? unknown(id, delivered.error ?? "渠道未确认结果", delivered)
							: delivered;
					} catch (error) {
						return unknown(id, error);
					}
				})();
			}
			state.queue.push(part);
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
		const seen = new Set<string>();
		const sources = actual.filter((event) => {
			if (
				waiting(session, event) !== false ||
				!event.conv ||
				!channels.has(channelId(event.conv) ?? "") ||
				(binding(session, event, profile)?.reply ?? "auto") !== "auto" ||
				seen.has(event.conv)
			)
				return false;
			seen.add(event.conv);
			return true;
		});
		const hasWaiter = actual.some((event) => waiting(session, event) === true);
		const stopped = run.status !== "done";
		const finalText = stopped
			? `运行已停止：${run.reason ?? run.status}。`
			: run.text.trim() === "NO_REPLY"
				? ""
				: run.text;
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
		const ending: EventInput & { data: { session: string; runId: string; [key: string]: unknown } } = {
			type: "run.end",
			...(fromSession(session) ? { from: fromSession(session)! } : {}),
			...(first ? { parent: first.id } : {}),
			...(first?.conv ? { conv: first.conv } : {}),
			data: {
				session: session.id,
				runId: run.runId,
				inputs: run.inputs,
				status: run.status,
				...(run.reason ? { reason: run.reason } : {}),
				replied,
				model: profile.resolved.model,
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
				for (const [, state] of owned) {
					state.queue.push({ type: "final", text: finalText });
					state.queue.end();
				}
				for (const event of targets) {
					if (owned.some(([, state]) => state.target === event.conv && state.delivery)) continue;
					await send(
						fromSession(session),
						{
							to: event.conv!,
							text: finalText,
							...((event.data as { msgId?: string }).msgId ? { replyTo: (event.data as { msgId: string }).msgId } : {}),
						},
						session,
						event.id,
						profile,
						AbortSignal.timeout(60000),
						run.runId,
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
					);
				for (const [, state] of owned)
					if (state.delivery) {
						const delivered = await state.delivery;
						// Thrown channel results already have an unknown receipt, not a false confirmation.
						if (!delivered.uncertain)
							await record(
								fromSession(session),
								state.target,
								{ text: finalText },
								delivered,
								session.id,
								state.owner,
								state.attempt,
							);
					}
			})().catch(report);
		};
		return { ending, deliver };
	}
	return {
		onStart,
		onRun,
		start,
		async recover() {
			for (const event of await store.events.unresolvedAttempts())
				await unknown(event.id, new Error("进程在渠道尝试后未保存确认"));
		},
		async sendPlugin(pluginId: string, request: MessageRequest): Promise<Delivery> {
			if (request.to === "owner") return { ok: false, error: "插件必须使用显式 person:、acct: 或 conv: 目标。" };
			return send(`plugin:${pluginId}`, request, undefined, undefined, undefined, request.signal);
		},
		async sendTool(ctx: ToolContext, request: MessageRequest): Promise<Delivery> {
			try {
				await options.runtime().authorizeAttachments(ctx, request.attachments);
			} catch (error) {
				return { ok: false, error: message(error) };
			}
			const session = await store.sessions.get(ctx.session);
			if (!session) throw new Error("当前会话不存在。");
			const config = options.runtime().currentConfig(ctx.session);
			let target: string;
			try {
				target = (await resolveTarget(request, ctx.agent, config)).target;
			} catch (error) {
				return { ok: false, error: message(error) };
			}
			if (
				!(ctx.events ?? (ctx.event ? [ctx.event] : [])).some((event) => event.conv === target) &&
				!ctx.capabilities.includes("message")
			)
				return { ok: false, error: "发往本次运行来源以外需要 message 能力。" };
			return send(fromSession(session), request, session, ctx.event?.id, config, ctx.signal);
		},
	};
}
export type DeliveryService = ReturnType<typeof createDelivery>;
