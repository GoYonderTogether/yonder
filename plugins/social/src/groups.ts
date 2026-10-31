import type { EventInput, PluginAPI, Ref, SocialPolicy, ToolContext, YEvent } from "@yonder/sdk";
import { GroupAttention } from "./group-attention.js";
import type { GroupJudgeConfig } from "./group-config.js";
import { groupContext } from "./group-context.js";
import { handleControl } from "./group-control.js";
import { driveDirect, queueDirect, runAutonomous, steerActive, unreadEntries } from "./group-direct.js";
import {
	type GroupPause,
	groupEvents,
	groupPolicies,
	groupRoomKey,
	publicEvents,
	publicHistory,
	restoreGroupState,
} from "./group-history.js";
import { GroupReview, reviewEligible } from "./group-review.js";
import { DIRECT_MERGE_MS, hasWork, quietDue, quietFor } from "./group-rhythm.js";
import { GroupRules, validateRules } from "./group-rules.js";
import { sendGuard } from "./group-send-guard.js";
import { awaitTurn, type GroupTurn, grantTurn, releaseTurn, stopGroupRequest, type TurnRoom } from "./group-turns.js";

export type { GroupJudgeConfig } from "./group-config.js";

interface Candidate {
	agent: string;
	conv: Ref;
	session: string;
	revision: string;
	policy: SocialPolicy;
	entries: YEvent[];
	pause?: GroupPause;
	counter: number;
	willing?: { through: string; entries: YEvent[]; decision: string };
	lastSent?: number;
	/** 08 官方群派生默认范围：没有硬触发就只记录，count 兜底不得自行唤醒。 */
	derivedDefault?: boolean;
}
interface Room extends TurnRoom {
	candidates: Map<string, Candidate>;
	convs: Set<Ref>;
	timer?: ReturnType<typeof setTimeout>;
	/** 每房间固定的静默值（5–15 秒），同批各候选一致，不用随机数决定谁先说。 */
	quietMs?: number;
	lastHumanAt?: number;
	/** 直接通道（明确点名与点名后的连续追问）的短合并截止时间。 */
	directUntil?: number;
}
export class Groups {
	private readonly rooms = new Map<string, Room>();
	private readonly aliases = new Map<Ref, string>();
	private readonly reads = new Map<string, string>();
	private readonly sessions = new Map<string, Room>();
	private readonly active = new Set<string>();
	private readonly pauses = new Map<string, GroupPause>();
	private readonly sent = new Map<string, number>();
	private readonly counters = new Map<string, number>();
	private readonly policies = new Map<string, { policy: SocialPolicy; revision: string }>();
	private readonly controls = new Set<string>();
	readonly rules: GroupRules;
	readonly review: GroupReview;
	private stopped = false;
	private readonly attention: GroupAttention;
	constructor(
		private readonly api: PluginAPI,
		private readonly config: GroupJudgeConfig,
		/** 房间索引只读快照：上下文只需要「同房间还有哪些 Bot」，不要每轮重扫账本。 */
		private readonly roomIndex?: () => Promise<
			Map<Ref, { convs: Ref[]; agents: Array<{ id: string; name?: string }> }>
		>,
	) {
		this.attention = new GroupAttention(api);
		for (const seed of Object.values(config.initialRules ?? {})) validateRules(seed);
		this.rules = new GroupRules(api, (conv) => this.managed(conv), config.initialRules);
		this.review = new GroupReview(api, config.preset, this.rules, config.review);
		for (const conv of config.conversations ?? []) this.aliases.set(conv, conv);
		for (const [i, convs] of (config.rooms ?? []).entries())
			for (const conv of convs) {
				if (this.aliases.has(conv) && this.aliases.get(conv) !== conv)
					throw Error("Group conversation is mapped twice");
				this.aliases.set(conv, `configured:${i}`);
			}
	}
	private key(agent: string, conv: string) {
		return `${agent}\0${conv}`;
	}
	private official(agent: string, conv: Ref) {
		return (this.policies.get(this.key(agent, conv))?.policy.plugin ?? "social") === "social";
	}
	async material(conv: string) {
		const room = this.rooms.get(this.aliases.get(conv) ?? "");
		return publicEvents(this.api, room?.convs ?? new Set([conv]));
	}
	managed(conv: Ref) {
		return this.aliases.has(conv);
	}
	private room(source: YEvent, membership = false, derived = false) {
		const key = groupRoomKey(source, this.aliases, membership, derived);
		if (!key) return;
		let room = this.rooms.get(key);
		if (!room) {
			room = {
				id: key,
				waiting: [],
				wake: new Set(),
				candidates: new Map(),
				convs: new Set(),
			};
			this.rooms.set(key, room);
		}
		room.convs.add(source.conv!);
		return room;
	}
	async start() {
		await restoreGroupState(this.api, this.reads, this.pauses, this.counters);
		await this.attention.start();
		await this.rules.start();
		for await (const event of groupEvents(this.api, "message.in")) await this.observe(event, false);
		for await (const event of groupEvents(this.api, "message.out")) await this.delivered(event, false);
		for await (const event of groupEvents(this.api, "routing.social-decision")) await this.accept(event, false);
		for (const room of this.rooms.values()) this.schedule(room);
		await this.review.start(
			() =>
				[...this.rooms.values()].flatMap((r) =>
					[...r.candidates.values()].map((c) => ({
						...c,
						identity: this.config.identities?.[c.agent] ?? "关注方向未知",
					})),
				),
			(t) => this.material(t.conv),
			(t, events) => reviewEligible(this.api, t, events),
		);
	}
	async observe(source: YEvent, live = true) {
		const facts = await groupPolicies(this.api, source);
		const room = this.room(
			source,
			facts.some((d) => d.membership),
			facts.some((d) => d.derivedDefault),
		);
		if (!room) return;
		for (const d of facts)
			if (d.agent && d.revision)
				this.policies.set(this.key(d.agent, source.conv!), { policy: d.policy ?? {}, revision: d.revision });
		const data = source.data as {
			senderIsBot?: boolean;
			mentioned?: boolean;
			social?: { mentions?: { bot?: boolean } };
		};
		for (const route of source.routes ?? [])
			if (route.session && !route.dropped && this.official(route.agent, source.conv!))
				this.sessions.set(route.session, room);
		if (data.senderIsBot) return;
		room.lastHumanAt = Math.max(room.lastHumanAt ?? 0, Date.parse(source.ts));
		if (!live) return;
		for (const route of source.routes ?? [])
			if (route.session && !route.dropped && this.official(route.agent, source.conv!))
				await this.control(source, route.agent, route.session, room);
		for (const route of source.routes ?? [])
			if (
				route.session &&
				this.sessions.get(route.session) === room &&
				!route.dropped &&
				!this.controls.has(source.id) &&
				(data.social?.mentions?.bot ?? data.mentioned) &&
				queueDirect(room, { ...route, session: route.session }, source, DIRECT_MERGE_MS)
			)
				// 直接通道用约 1–1.5 秒短合并，收集同一段连续 @/追问，避免长 digest 延迟。
				this.scheduleOffer(room, Math.max(0, (room.directUntil ?? 0) - Date.now()));
	}
	async accept(event: YEvent, schedule = true) {
		const data = event.data as {
			agent?: string;
			reason?: string;
			run?: boolean;
			revision?: string;
			policy?: SocialPolicy;
			membership?: boolean;
			derivedDefault?: boolean;
		};
		// 批次与自主候选走 reason=batch；官方群 write 绑定下的硬触发（@/引用/名字/关注）记 run=true，
		// 同样需要一个带 revision 与策略的候选，才能在短合并后由 social 发起运行。
		const eligible = data.reason === "batch" || data.run === true;
		if (this.stopped || !eligible || !data.agent || !data.revision || !event.parent) return;
		if (data.policy?.plugin && data.policy.plugin !== "social") return;
		const source = (await this.api.events.query({ id: event.parent })).events[0];
		if (!source) return;
		const room = this.room(source, data.membership === true, data.derivedDefault === true);
		const route = source.routes?.find((r) => r.agent === data.agent && r.wake === "write" && !r.dropped);
		if (!room || !source.conv || !route?.session || (source.data as { senderIsBot?: boolean }).senderIsBot) return;
		this.sessions.set(route.session, room);
		if (source.id <= (this.reads.get(this.key(data.agent, source.conv)) ?? "")) return;
		let candidate = room.candidates.get(data.agent);
		if (!candidate || candidate.conv !== source.conv || candidate.revision !== data.revision) {
			candidate = {
				agent: data.agent,
				conv: source.conv,
				session: route.session,
				revision: data.revision,
				policy: data.policy ?? {},
				entries: [],
				counter: this.counters.get(this.key(data.agent, source.conv)) ?? 0,
				lastSent: this.sent.get(this.key(data.agent, source.conv)) ?? 0,
				...(data.derivedDefault === true ? { derivedDefault: true } : {}),
			};
			const pause = this.pauses.get(this.key(data.agent, source.conv));
			if (pause) candidate.pause = pause;
			room.candidates.set(data.agent, candidate);
		}

		if (!candidate.entries.some((e) => e.id === source.id)) candidate.entries.push(source);
		candidate.entries.sort((a, b) => a.id.localeCompare(b.id));
		if (candidate.willing && !(await this.attention.elsewhere(source, data.agent))) {
			candidate.willing.entries.push(source);
			candidate.willing.through = source.id;
		}
		room.quietMs ??= quietFor(room.id);
		if (schedule) this.schedule(room);
	}
	private schedule(room: Room, delay = 3000) {
		if (this.stopped || room.timer || !hasWork(room.candidates.values())) return;
		room.timer = setTimeout(() => {
			delete room.timer;
			void this.flush(room).catch((error) =>
				this.api.log.warn("Group observation failed; wait for new input", { error: String(error) }),
			);
		}, delay);
		room.timer.unref();
	}
	/** 已经算好发言机会、只等静默/短合并到期时重新排期，不再重新匹配规则。 */
	private scheduleOffer(room: Room, delay: number) {
		if (this.stopped || room.timer) return;
		room.timer = setTimeout(
			() => {
				delete room.timer;
				void this.offer(room).catch((error) =>
					this.api.log.warn("Group coordination failed; wait for new input", { error: String(error) }),
				);
			},
			Math.max(0, delay),
		);
		room.timer.unref();
	}
	private request(c: Candidate, entries: YEvent[]) {
		return {
			agent: c.agent,
			conv: c.conv,
			through: entries.at(-1)!.id,
			sourceEvents: entries.map((e) => e.id),
			policyRevision: c.revision,
		};
	}
	private async read(c: Candidate, entries: YEvent[], parent: string) {
		const through = entries.at(-1)?.id;
		if (!through) return;
		await this.api.events.emit({
			type: "social.batch-read",
			from: "plugin:social",
			conv: c.conv,
			parent,
			data: { msgId: `group-read:${parent}:${c.agent}:${through}`, agent: c.agent, through },
		});
		this.reads.set(this.key(c.agent, c.conv), through);
		c.entries = c.entries.filter((e) => e.id > through);
		const room = this.sessions.get(c.session);
		if (room && ![...room.candidates.values()].some((c) => c.entries.length)) delete room.quietMs;
	}
	private async control(source: YEvent, agent: string, session: string, room: Room) {
		const key = this.key(agent, source.conv!);
		const before = this.pauses.get(key);
		const result = await handleControl(this.api, {
			source,
			agent,
			session,
			claimed: this.controls,
			before,
			awaiting: () => (room.turn?.session === session ? room.turn : room.waiting.find((t) => t.session === session)),
			narrow: async (affects, pause) => {
				const c = room.candidates.get(agent);
				if (c) {
					if (pause) c.pause = pause;
					else delete c.pause;
					if (affects) delete c.willing;
				}
				if (affects) room.waiting = room.waiting.filter((t) => t.session !== session);
				if (affects && room.turn?.session === session) await releaseTurn(this.api, room, source.id);
			},
		});
		if (!result) return;
		if (result.pause) this.pauses.set(key, result.pause);
		else this.pauses.delete(key);
		await this.offer(room);
	}
	private async flush(room: Room) {
		for (const c of room.candidates.values()) {
			if (!c.entries.length || c.willing) continue;
			const through = room.turn?.session === c.session ? room.turn.source : "";
			const entries = c.entries.filter((e) => e.id > through).slice(0, 100);
			if (!entries.length) continue;
			if ((await this.api.social?.admitBatch(this.request(c, entries)))?.session !== c.session) continue;
			const policy = this.rules.effective(c.agent, c.conv, c.policy, c.revision);
			// 08：派生默认范围只有显式 `batch.run: true` 才允许无硬触发的批次；count 兜底不算硬触发。
			const countFallback = !c.derivedDefault || policy.batch?.run === true;
			const { matched, focused, errors, relevant } = await this.attention.consider(
				c,
				room.id,
				entries,
				policy,
				this.controls,
				{ countFallback },
			);
			const fact = await this.api.events.emit({
				type: "social.rule-match",
				from: "plugin:social",
				conv: c.conv,
				data: {
					...this.request(c, entries),
					matched,
					focused,
					counter: c.counter,
					regexErrors: errors,
					rulesRevision: this.rules.version(c.agent, c.conv, c.revision)?.id ?? c.revision,
				},
			});
			this.counters.set(this.key(c.agent, c.conv), c.counter);
			if (!matched) {
				await this.read(c, entries, fact.id);
				continue;
			}
			if (this.active.has(c.session)) {
				// 相关补充沿原生 busy:steer 把真实新增消息与来源并入当前运行；工具运行中由原生等待边界。
				// 只走已有的批次事件、准入与绑定，不另造队列，也不发没有来源的“请复核”。
				const through = relevant.at(-1)!.id;
				await steerActive(this.api, room, c, {
					entries: relevant,
					read: entries.filter((entry) => entry.id <= through),
					through,
					onRead: (covered, parent) => this.read(c, covered, parent),
				});
			} else c.willing = { through: relevant.at(-1)!.id, entries: relevant, decision: fact.id };
		}
		await this.offer(room);
	}
	private async offer(room: Room) {
		if (this.stopped || room.turn) return;
		const direct = room.waiting[0];
		if (direct) {
			// 直接通道：约 1–1.5 秒短合并，同一段连续 @/追问只产生一次机会。
			const until = room.directUntil ?? 0;
			if (until > Date.now()) {
				this.scheduleOffer(room, until - Date.now());
				return;
			}
			room.waiting.shift();
			delete room.directUntil;
			await grantTurn(this.api, room, direct);
			if (direct.driver === "social") await this.drive(room, direct);
			return;
		}
		const willing = [...room.candidates.values()].filter(
			(c) => c.willing && !this.active.has(c.session) && c.pause?.scope !== "group",
		);
		if (!willing.length) return;
		// 自主候选：静默窗口对同批各候选一致，自首条起最长 120 秒硬顶，之后必须运行或记录沉默。
		const due = quietDue(
			room.lastHumanAt,
			room.quietMs ?? quietFor(room.id),
			willing.map((c) => c.willing!.entries[0]!.ts),
		);
		if (due > Date.now()) {
			this.scheduleOffer(room, due - Date.now());
			return;
		}
		willing.sort(
			(a, b) =>
				(a.lastSent ?? 0) - (b.lastSent ?? 0) || a.willing!.entries[0]!.id.localeCompare(b.willing!.entries[0]!.id),
		);
		const c = willing[0]!;
		const intention = c.willing!;
		delete c.willing;
		if (!(await this.api.social?.admitBatch(this.request(c, intention.entries)))) return;
		await grantTurn(this.api, room, {
			agent: c.agent,
			session: c.session,
			source: intention.through,
			decision: intention.decision,
			direct: false,
		});
		await runAutonomous(this.api, room, c, {
			through: intention.through,
			entries: intention.entries,
			active: this.active,
			onRead: (entries, parent) => this.read(c, entries, parent),
			offer: () => this.offer(room),
		});
	}
	private async drive(room: Room, turn: GroupTurn) {
		const entries = await unreadEntries(this.api, turn, this.reads.get(this.key(turn.agent, turn.conv!)) ?? "");
		await driveDirect(entries, {
			api: this.api,
			room,
			turn,
			active: this.active,
			// 候选可能还没由 routing.social-decision 建立；修订取自同一条事实，不自行编造。
			revision: (agent, conv) =>
				room.candidates.get(agent)?.revision ?? this.policies.get(this.key(agent, conv))?.revision ?? "",
			read: async (covered, parent) => {
				const candidate = room.candidates.get(turn.agent);
				if (candidate) await this.read(candidate, covered, parent);
			},
			release: async (reason) => {
				if (room.turn === turn) await releaseTurn(this.api, room, turn.source, reason);
			},
			offer: () => this.offer(room),
		});
	}
	async delivered(event: YEvent, live = true) {
		if (!(event.data as { delivery?: { ok?: boolean } }).delivery?.ok || !event.conv) return;
		const room = this.rooms.get(this.aliases.get(event.conv) ?? "");
		if (!room) return;
		const agent = event.from?.startsWith("agent:") ? event.from.slice(6) : undefined;
		if (!agent) return;
		const c = room.candidates.get(agent);
		this.sent.set(this.key(agent, event.conv), Date.parse(event.ts));
		if (c) c.lastSent = Date.parse(event.ts);
		await this.attention.replied(event, room.id);
		if (!live) return;
		for (const peer of room.candidates.values())
			if (peer.agent !== agent && peer.willing) {
				delete peer.willing;
				await this.read(peer, peer.entries, event.id);
			}
		this.schedule(room);
	}
	async beforeRequest(ctx: ToolContext) {
		const sources = ctx.events ?? (ctx.event ? [ctx.event] : []);
		for (const event of sources) if (event.type === "message.in") await this.observe(event);
		const room = this.sessions.get(ctx.session);
		if (!room || !ctx.agent || !this.official(ctx.agent, ctx.event?.conv ?? "")) return;
		const pause = this.pauses.get(this.key(ctx.agent, ctx.event?.conv ?? ""));
		if (pause?.scope === "group" || sources.some((e) => this.controls.has(e.id))) await stopGroupRequest(this.api, ctx);
		this.active.add(ctx.session);
		await awaitTurn(room, ctx, () => this.stopped);
		return groupContext(this.api, {
			room,
			ctx,
			sources,
			...(this.roomIndex ? { roomIndex: this.roomIndex } : {}),
		});
	}
	async finished(event: YEvent) {
		const session = (event.data as { session?: string }).session;
		if (!session) return;
		this.active.delete(session);
		const room = this.sessions.get(session);
		if (room?.turn?.session === session) {
			await releaseTurn(this.api, room, event.id);
			await this.offer(room);
		}
	}
	async beforeSend(to: Ref, owner?: { session: string; agent: string | null }) {
		if (!owner?.agent || !this.official(owner.agent, to)) return;
		const room = this.sessions.get(owner.session);
		if (!room) return;
		const c = room.candidates.get(owner.agent);
		const error = await sendGuard(this.api, {
			to,
			agent: owner.agent,
			session: owner.session,
			room,
			paused: (c?.pause ?? this.pauses.get(this.key(owner.agent, to)))?.scope === "group",
		});
		if (error) throw Error(error);
	}
	stop() {
		this.stopped = true;
		this.review.stop();
		for (const room of this.rooms.values()) {
			if (room.timer) clearTimeout(room.timer);
			for (const wake of room.wake) wake();
		}
	}
}
