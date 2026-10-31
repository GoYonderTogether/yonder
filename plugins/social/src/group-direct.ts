import type { EventInput, PluginAPI, Ref, YEvent } from "@yonder/sdk";
import { publicHistory } from "./group-history.js";
import { type GroupTurn, releaseTurn, type TurnRoom } from "./group-turns.js";

interface DirectOptions {
	api: PluginAPI;
	room: TurnRoom & { candidates: Map<string, unknown> };
	turn: GroupTurn;
	active: Set<string>;
	/** 当前生效的策略修订；候选未建立时取同一条 `routing.social-decision` 事实。 */
	revision: (agent: string, conv: Ref) => string;
	read: (entries: YEvent[], parent: string) => Promise<void>;
	/** 只在该机会仍是房间当前机会时释放，并记录真实原因。 */
	release: (reason: string) => Promise<void>;
	offer: () => Promise<void>;
}

/** 本批真实未读来源：按事件 id 升序，最多 100 条；已读游标之后才算。 */
export async function unreadEntries(api: PluginAPI, turn: GroupTurn, read: string) {
	const conv = turn.conv;
	if (!conv) return [];
	const ids = [...new Set(turn.sources ?? [turn.source])].sort();
	const events: YEvent[] = [];
	for (const id of ids) {
		if (id <= read) continue;
		const event = (await api.events.query({ id })).events[0];
		if (event?.type === "message.in" && event.conv === conv) events.push(event);
	}
	return events.slice(0, 100);
}

/**
 * 官方群的群原消息是 write 绑定，内核不会为 @ 自行启动运行：短合并结束后由 social 发批次，
 * 走同一 `social.batch-ready` 绑定、准入与原生会话，不另造队列。
 */
export async function driveDirect(entries: YEvent[], options: DirectOptions) {
	const { api, room, turn } = options;
	if (!entries.length) {
		await options.release("no-unread");
		return;
	}
	const conv = turn.conv!;
	const request = {
		agent: turn.agent,
		conv,
		through: entries.at(-1)!.id,
		sourceEvents: entries.map((event) => event.id),
		policyRevision: options.revision(turn.agent, conv),
	};
	if (!(await api.social?.admitBatch(request))) {
		api.log.info("Group direct opportunity is no longer admitted", {
			agent: turn.agent,
			conv,
			through: request.through,
		});
		await options.release("no-longer-admitted");
		return;
	}
	options.active.add(turn.session);
	const input: EventInput = {
		type: "social.batch-ready",
		from: "plugin:social",
		conv,
		data: {
			...request,
			msgId: `direct:${turn.agent}:${request.through}`,
			publicHistory: await publicHistory(api, room.convs),
		},
	};
	void api.events
		.ask(input)
		.then(async (result) => {
			// 只有真实完成才推进游标；失败保持未读，不伪装已观察。
			if (result.results.length && result.results.every((run) => run.status === "done"))
				await options.read(entries, result.event.id);
		})
		.catch((error) => api.log.warn("Group direct participation failed", { agent: turn.agent, error: String(error) }))
		.finally(async () => {
			options.active.delete(turn.session);
			await options.release("direct-run-ended");
			await options.offer();
		});
}

/** 运行中的相关补充：把真实新增消息与来源作为一次批次并入当前运行，失败保持未读。 */
export async function steerActive(
	api: PluginAPI,
	room: { convs: Set<Ref> },
	c: { agent: string; conv: Ref; revision: string },
	options: {
		entries: YEvent[];
		/** 只有到 `through` 为止的来源才算已观察。 */
		read: YEvent[];
		through: string;
		onRead: (entries: YEvent[], parent: string) => Promise<void>;
	},
) {
	const request = {
		agent: c.agent,
		conv: c.conv,
		through: options.through,
		sourceEvents: options.entries.map((event) => event.id),
		policyRevision: c.revision,
	};
	const input: EventInput = {
		type: "social.batch-ready",
		from: "plugin:social",
		conv: c.conv,
		data: {
			...request,
			msgId: `steer:${c.agent}:${options.through}`,
			publicHistory: await publicHistory(api, room.convs),
		},
	};
	await api.events
		.ask(input)
		.then(async (result) => {
			// 只有真实完成才推进游标；失败保持未读，不伪装已观察。
			if (result.results.length && result.results.every((run) => run.status === "done"))
				await options.onRead(options.read, result.event.id);
		})
		.catch((error) =>
			api.log.warn("Group steer failed; the new input stays unread", { agent: c.agent, error: String(error) }),
		);
}

/** 直接通道（明确点名与点名后的连续追问）的排队与短合并截止时间更新。 */
export function queueDirect(
	room: TurnRoom & { directUntil?: number },
	route: { agent: string; session: string; wake?: "run" | "write" },
	source: YEvent,
	mergeMs: number,
) {
	const conv = source.conv;
	if (!conv) return false;
	const queued = room.waiting.find((turn) => turn.session === route.session);
	if (queued) {
		// 同一段连续追问：把真实新增消息并入已经排队的直接机会，不另开一次运行。
		queued.sources = [...new Set([...(queued.sources ?? []), source.id])];
		queued.source = source.id;
	} else {
		if (room.turn?.session === route.session) return false;
		room.waiting.push({
			agent: route.agent,
			session: route.session,
			source: source.id,
			decision: source.id,
			direct: true,
			sources: [source.id],
			driver: route.wake === "run" ? "kernel" : "social",
			conv,
		});
	}
	room.directUntil = Math.max(room.directUntil ?? 0, Date.parse(source.ts) + mergeMs);
	return true;
}

/** 自主候选获准后的真实运行：同一 `social.batch-ready` 绑定与准入，游标只在真实完成后推进。 */
export async function runAutonomous(
	api: PluginAPI,
	room: TurnRoom,
	c: { agent: string; conv: Ref; revision: string; session: string },
	options: {
		through: string;
		entries: YEvent[];
		active: Set<string>;
		onRead: (entries: YEvent[], parent: string) => Promise<void>;
		offer: () => Promise<void>;
	},
) {
	const input: EventInput = {
		type: "social.batch-ready",
		from: "plugin:social",
		conv: c.conv,
		data: {
			agent: c.agent,
			conv: c.conv,
			through: options.through,
			sourceEvents: options.entries.map((event) => event.id),
			policyRevision: c.revision,
			msgId: `group:${c.agent}:${options.through}`,
			publicHistory: await publicHistory(api, room.convs),
		},
	};
	options.active.add(c.session);
	void api.events
		.ask(input)
		.then(async (result) => {
			if (result.results.length && result.results.every((run) => run.status === "done"))
				await options.onRead(options.entries, result.event.id);
		})
		.catch((error) => api.log.warn("Group participation failed", { agent: c.agent, error: String(error) }))
		.finally(async () => {
			options.active.delete(c.session);
			if (room.turn?.agent === c.agent) await releaseTurn(api, room, options.through);
			await options.offer();
		});
}
