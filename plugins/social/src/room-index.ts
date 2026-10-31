import type { PluginAPI, Ref, YEvent } from "@yonder/sdk";

/**
 * 跨 Bot 的群房间索引。
 *
 * QQ 给每个机器人一套不同的群 openid，同一个真实群在各 Bot 眼里是不同的 conv；平台也不提供群成员列表。
 * 本机所有 Bot 的账本在同一个事件库里，因此「同一个真实群」只能由本机事实推断，而不是由平台告知。
 *
 * 两条事实用来合并：
 * 1. 配置显式登记的房间（`social.rooms`），优先级最高；
 * 2. 同一条消息出现在两个群 conv 里——发送者、平台发送时间、正文都相同。接收时间每个机器人各不相同，
 *    真正稳定的是 `createdAt`（平台发送时间）。
 *
 * 索引只读账本，不写事件；每条结论都带证据，没有证据的群保持独立，名字缺失时不编造。
 */
export interface GroupIndexEntry {
	room: Ref;
	/** 同一个真实群在各自 Bot 眼里的 conv。 */
	convs: Ref[];
	/** 这些 conv 所属的渠道实例，例如 `qq-jarvis`。 */
	instances: string[];
	/** 在本房间里发过言的 Agent（来自成功投递的 message.out）。 */
	agents: Array<{ id: string; name?: string }>;
	/** 在本房间出现过的人，按最后一次发言时间倒序；bot 表示平台判定为机器人账号。 */
	people: Array<{ ref: Ref; name?: string; bot: boolean; lastAt: string }>;
	evidence: Array<{ kind: "configured" | "message"; detail: string }>;
}

const MAX_EVENTS = 5000;
const MAX_PEOPLE = 30;

const instanceOf = (conv: Ref) => conv.split(":")[1] ?? "";

/** 一条群消息的稳定指纹：发送者、平台发送时间、正文。缺一项就不参与合并。 */
function fingerprint(event: YEvent): string | undefined {
	const data = event.data as { kind?: string; createdAt?: string; text?: string };
	if (data.kind !== "group" || !event.from || !data.createdAt || !data.text) return;
	return `${event.from}\u0000${data.createdAt}\u0000${data.text}`;
}

async function* allEvents(api: PluginAPI, type: string) {
	let after: string | undefined;
	do {
		const page = await api.events.query({ type, limit: 1000, ...(after ? { after } : {}) });
		for (const event of page.events) yield event;
		after = page.next;
	} while (after);
}

export class GroupIndex {
	private readonly configured = new Map<Ref, Ref>();
	private cached?: { at: number; index: Map<Ref, GroupIndexEntry> };
	constructor(
		private readonly api: PluginAPI,
		/** 缓存时长：上下文注入会在每次请求前调用，账本不必每一轮都全量重扫。 */
		private readonly ttlMs = 15_000,
	) {}

	/** 配置里显式登记的房间：同一组的 conv 合并到一个稳定房间 id 下。 */
	seed(rooms: readonly (readonly Ref[])[] | undefined) {
		for (const [index, convs] of (rooms ?? []).entries())
			for (const conv of convs) this.configured.set(conv, `configured:${index}`);
	}

	/** 短时间内复用上一次结果；账本只追加，稍旧的索引不会更错，只是少几条最新消息。 */
	async build(): Promise<Map<Ref, GroupIndexEntry>> {
		const now = Date.now();
		if (this.cached && now - this.cached.at < this.ttlMs) return this.cached.index;
		const index = await this.scan();
		this.cached = { at: now, index };
		return index;
	}

	private async scan(): Promise<Map<Ref, GroupIndexEntry>> {
		const agents = new Map((await this.api.agents.list()).map((agent) => [agent.id, agent.name]));
		const byConv = new Map<
			Ref,
			{ froms: Map<Ref, { name?: string; bot: boolean; lastAt: string }>; speakers: Set<string> }
		>();
		const buckets = new Map<string, Set<Ref>>();
		let seen = 0;
		for await (const event of allEvents(this.api, "message.in")) {
			const data = event.data as { kind?: string; name?: string; senderIsBot?: boolean };
			if (data.kind !== "group" || !event.conv) continue;
			if (++seen > MAX_EVENTS) break;
			const entry = byConv.get(event.conv) ?? { froms: new Map(), speakers: new Set<string>() };
			byConv.set(event.conv, entry);
			if (event.from) {
				const prior = entry.froms.get(event.from);
				entry.froms.set(event.from, {
					...(data.name ? { name: data.name } : prior?.name ? { name: prior.name } : {}),
					bot: data.senderIsBot === true || prior?.bot === true,
					lastAt: prior && prior.lastAt > event.ts ? prior.lastAt : event.ts,
				});
			}
			const print = fingerprint(event);
			if (print) {
				const room = buckets.get(print) ?? new Set<Ref>();
				room.add(event.conv);
				buckets.set(print, room);
			}
		}
		// 哪个 Agent 在哪个 conv 发过言：message.out 的 from 就是 agent:<id>，这是唯一可靠的实例↔Agent 映射。
		for await (const event of allEvents(this.api, "message.out")) {
			const data = event.data as { delivery?: { ok?: boolean } };
			if (data.delivery?.ok !== true || !event.conv || !event.from?.startsWith("agent:")) continue;
			const entry = byConv.get(event.conv);
			if (entry) entry.speakers.add(event.from.slice("agent:".length));
		}
		// 指纹把同一个真实群的多个 conv 连起来；每个 conv 取它所在指纹簇里最小的 conv 作为房间 id，
		// 这样多簇也能收敛到同一个稳定值，且结果与遍历顺序无关。
		const cluster = new Map<Ref, Ref>();
		for (const convs of buckets.values()) {
			if (convs.size < 2) continue;
			const room = [...convs].sort()[0]!;
			for (const conv of convs) {
				const prior = cluster.get(conv);
				if (!prior || room < prior) cluster.set(conv, room);
			}
		}
		const roomOf = (conv: Ref) => this.configured.get(conv) ?? cluster.get(conv) ?? conv;

		const index = new Map<Ref, GroupIndexEntry>();
		const people = new Map<Ref, Map<Ref, { name?: string; bot: boolean; lastAt: string }>>();
		const speakers = new Map<Ref, Set<string>>();
		for (const [conv, entry] of byConv) {
			const room = roomOf(conv);
			const target = index.get(room) ?? { room, convs: [], instances: [], agents: [], people: [], evidence: [] };
			target.convs.push(conv);
			const instance = instanceOf(conv);
			if (instance && !target.instances.includes(instance)) target.instances.push(instance);
			if (this.configured.has(conv) && !target.evidence.some((item) => item.kind === "configured"))
				target.evidence.push({ kind: "configured", detail: "配置登记的房间" });
			const merged = cluster.get(conv);
			if (merged && merged !== conv)
				target.evidence.push({
					kind: "message",
					detail: `与 ${merged} 收到过同一条消息（发送者、发送时间、正文一致）`,
				});
			const known = people.get(room) ?? new Map();
			for (const [ref, info] of entry.froms) {
				const prior = known.get(ref);
				known.set(ref, {
					...(info.name ? { name: info.name } : prior?.name ? { name: prior.name } : {}),
					bot: info.bot || prior?.bot === true,
					lastAt: prior && prior.lastAt > info.lastAt ? prior.lastAt : info.lastAt,
				});
			}
			people.set(room, known);
			const roomSpeakers = speakers.get(room) ?? new Set<string>();
			for (const agent of entry.speakers) roomSpeakers.add(agent);
			speakers.set(room, roomSpeakers);
			index.set(room, target);
		}
		for (const entry of index.values()) {
			entry.convs.sort();
			entry.instances.sort();
			entry.agents = [...(speakers.get(entry.room) ?? [])]
				.sort()
				.map((id) => ({ id, ...(agents.get(id) ? { name: agents.get(id)! } : {}) }));
			entry.people = [...(people.get(entry.room) ?? new Map()).entries()]
				.map(([ref, info]) => ({ ref, ...info }))
				.sort((a, b) => b.lastAt.localeCompare(a.lastAt))
				.slice(0, MAX_PEOPLE);
		}
		return index;
	}

	/** 某个 conv 所属的房间。 */
	static roomOf(index: Map<Ref, GroupIndexEntry>, conv: Ref): GroupIndexEntry | undefined {
		for (const entry of index.values()) if (entry.convs.includes(conv)) return entry;
	}
}
