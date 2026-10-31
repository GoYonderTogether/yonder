import type { EventInput, PluginAPI, Ref, SocialPolicy, ToolContext, YEvent } from "@yonder/sdk";
import { GroupAttention } from "./group-attention.js";
import type { GroupJudgeConfig } from "./group-config.js";
import {
	type GroupPause,
	groupEvents,
	groupPolicies,
	groupRoomKey,
	publicEvents,
	publicHistory,
	restoreGroupState,
} from "./group-history.js";
import { GroupReview } from "./group-review.js";
import { GroupRules, validateRules } from "./group-rules.js";
import { awaitTurn, grantTurn, releaseTurn, stopGroupRequest, type TurnRoom } from "./group-turns.js";

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
}
interface Room extends TurnRoom {
	candidates: Map<string, Candidate>;
	convs: Set<Ref>;
	timer?: ReturnType<typeof setTimeout>;
	quietMs?: number;
	lastHumanAt?: number;
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
	private room(source: YEvent, membership = false) {
		const key = groupRoomKey(source, this.aliases, membership);
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
			async (t, events) => {
				const eligible = events.filter(
					(e) =>
						e.conv === t.conv &&
						e.routes?.some((r) => r.agent === t.agent && r.session === t.session && r.wake === "write" && !r.dropped),
				);
				return (
					!!eligible.length &&
					!!(await this.api.social?.admitBatch({
						agent: t.agent,
						conv: t.conv,
						through: eligible.at(-1)!.id,
						sourceEvents: eligible.map((e) => e.id),
						policyRevision: t.revision,
					}))
				);
			},
		);
	}
	async observe(source: YEvent, live = true) {
		const facts = await groupPolicies(this.api, source);
		const room = this.room(
			source,
			facts.some((d) => d.membership),
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
				route.wake === "run" &&
				(data.social?.mentions?.bot ?? data.mentioned)
			) {
				if (room.turn?.session !== route.session)
					if (!room.waiting.some((t) => t.session === route.session)) {
						room.waiting.push({
							agent: route.agent,
							session: route.session,
							source: source.id,
							decision: source.id,
							direct: true,
						});
						void this.offer(room);
					}
			}
	}
	async accept(event: YEvent, schedule = true) {
		const data = event.data as {
			agent?: string;
			reason?: string;
			revision?: string;
			policy?: SocialPolicy;
			membership?: boolean;
		};
		if (this.stopped || data.reason !== "batch" || !data.agent || !data.revision || !event.parent) return;
		if (data.policy?.plugin && data.policy.plugin !== "social") return;
		const source = (await this.api.events.query({ id: event.parent })).events[0];
		if (!source) return;
		const room = this.room(source, data.membership === true);
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
		room.quietMs ??= 5000 + Math.floor(Math.random() * 10001);
		if (schedule) this.schedule(room);
	}
	private schedule(room: Room, delay = 3000) {
		if (this.stopped || room.timer || ![...room.candidates.values()].some((c) => c.entries.length || c.willing)) return;
		room.timer = setTimeout(() => {
			delete room.timer;
			void this.flush(room).catch((error) =>
				this.api.log.warn("Group observation failed; wait for new input", { error: String(error) }),
			);
		}, delay);
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
		const text = String((source.data as { text?: string }).text ?? "");
		const name = (await this.api.agents.list()).find((a) => a.id === agent)?.name ?? agent;
		const native = source.data as { mentioned?: boolean; social?: { mentions?: { bot?: boolean } } };
		const addressed = (native.social?.mentions?.bot ?? native.mentioned) || text.includes(name) || text.includes(agent);
		if (!addressed) return;
		const body = text
			.replace(/<@[^>]+>/g, "")
			.replaceAll(name, "")
			.replaceAll(agent, "")
			.replace(/^[\s,，:：]+|[\s。！!]+$/g, "");
		const stop = /^(?:请)?(?:闭嘴(?:[，, ]*禁言)?|禁言|停止回复|不用回答我|不用回复|别回复了)$/.test(body);
		const resume = /^(?:恢复回复|解除禁言|继续回复)$/.test(body);
		if (!stop && !resume) return;
		const manager =
			!!source.from?.startsWith("acct:") &&
			((await this.api.identity.relation(agent, source.from)) === "owner" ||
				["group-owner", "group-admin"].includes(
					(source.data as { social?: { senderRole?: string } }).social?.senderRole ?? "",
				));
		if ((resume && !manager) || this.controls.has(source.id)) return;
		this.controls.add(source.id);
		const key = this.key(agent, source.conv!);
		const before = this.pauses.get(key);
		const pause: GroupPause | undefined =
			before?.scope === "group" && stop
				? before
				: stop
					? {
							source: source.id,
							...(source.from ? { actor: source.from } : {}),
							scope: manager && body !== "不用回答我" ? "group" : "interaction",
						}
					: undefined;
		await this.api.events.emit({
			type: "social.policy-change",
			from: "plugin:social",
			conv: source.conv!,
			parent: source.id,
			data: {
				kind: "group-pause",
				agent,
				actor: source.from,
				sourceEvent: source.id,
				before: { pause: before ?? null },
				after: { pause: pause ?? null },
				reason: body,
				result: "applied",
				restore: "owner or group manager explicitly resumes",
			},
		});
		if (pause) this.pauses.set(key, pause);
		else this.pauses.delete(key);
		const current = room.turn?.session === session ? room.turn : room.waiting.find((t) => t.session === session);
		const origin = current ? (await this.api.events.query({ id: current.source })).events[0]?.from : undefined;
		const affectsRun = pause?.scope === "group" || origin === source.from;
		const c = room.candidates.get(agent);
		if (c) {
			if (pause) c.pause = pause;
			else delete c.pause;
			if (affectsRun) delete c.willing;
		}
		if (affectsRun) room.waiting = room.waiting.filter((t) => t.session !== session);
		if (stop && affectsRun)
			void this.api.sessions
				.abort(session)
				.catch((error) => this.api.log.warn("Group stop failed", { session, error: String(error) }));
		if (affectsRun && room.turn?.session === session) await releaseTurn(this.api, room, source.id);
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
			const { matched, focused, errors, relevant } = await this.attention.consider(
				c,
				room.id,
				entries,
				policy,
				this.controls,
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
				await this.api.sessions.submit(
					c.session,
					{
						text: `群内新公开信息，检查是否仍需回应；可保持沉默：\n${JSON.stringify(await publicHistory(this.api, room.convs))}`,
					},
					{ busy: "steer" },
				);
				await this.read(c, entries, fact.id);
			} else c.willing = { through: relevant.at(-1)!.id, entries: relevant, decision: fact.id };
		}
		await this.offer(room);
	}
	private async offer(room: Room) {
		if (this.stopped || room.turn) return;
		const direct = room.waiting.shift();
		if (direct) {
			await grantTurn(this.api, room, direct);
			return;
		}
		const willing = [...room.candidates.values()].filter(
			(c) => c.willing && !this.active.has(c.session) && c.pause?.scope !== "group",
		);
		if (!willing.length) return;
		const due = Math.min(
			(room.lastHumanAt ?? Date.now()) + (room.quietMs ?? 5000),
			Date.parse(willing[0]!.willing!.entries[0]!.ts) + 120000,
		);
		if (due > Date.now()) {
			this.schedule(room, due - Date.now());
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
		const input: EventInput = {
			type: "social.batch-ready",
			from: "plugin:social",
			conv: c.conv,
			data: {
				...this.request(c, intention.entries),
				msgId: `group:${c.agent}:${intention.through}`,
				publicHistory: await publicHistory(this.api, room.convs),
			},
		};
		this.active.add(c.session);
		void this.api.events
			.ask(input)
			.then(async (result) => {
				if (result.results.length && result.results.every((r) => r.status === "done"))
					await this.read(c, intention.entries, result.event.id);
			})
			.catch((error) => this.api.log.warn("Group participation failed", { agent: c.agent, error: String(error) }))
			.finally(async () => {
				this.active.delete(c.session);
				if (room.turn?.agent === c.agent) await releaseTurn(this.api, room, intention.through);
				await this.offer(room);
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
		for (const event of ctx.events ?? (ctx.event ? [ctx.event] : []))
			if (event.type === "message.in") await this.observe(event);
		const room = this.sessions.get(ctx.session);
		if (!room || !ctx.agent || !this.official(ctx.agent, ctx.event?.conv ?? "")) return;
		const pause = this.pauses.get(this.key(ctx.agent, ctx.event?.conv ?? ""));
		if (pause?.scope === "group" || (ctx.events ?? (ctx.event ? [ctx.event] : [])).some((e) => this.controls.has(e.id)))
			await stopGroupRequest(this.api, ctx);
		this.active.add(ctx.session);
		await awaitTurn(room, ctx, () => this.stopped);
		return publicHistory(this.api, room.convs);
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
		if (!room?.convs.has(to)) return;
		const c = room.candidates.get(owner.agent);
		if (
			(c?.pause ?? this.pauses.get(this.key(owner.agent, to)))?.scope === "group" ||
			room.turn?.session !== owner.session
		)
			throw Error("本群当前没有此Bot的发言机会或已暂停；不要重试发送，等待下一次群输入。");
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
