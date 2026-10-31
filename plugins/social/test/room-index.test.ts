import { expect, test } from "vitest";
import { GroupIndex } from "../src/room-index.js";

type Event = {
	id: string;
	type: string;
	ts: string;
	conv?: string;
	from?: string;
	data: Record<string, unknown>;
};

/** 一个最小的只读账本：只实现 build() 用到的 `events.query` 和 `agents.list`。 */
function api(events: Event[], agents: Array<{ id: string; name: string }> = []) {
	return {
		events: {
			async query({ type, limit = 1000, after }: { type: string; limit?: number; after?: string }) {
				const rows = events
					.filter((event) => event.type === type && (!after || event.id > after))
					.sort((a, b) => a.id.localeCompare(b.id));
				const page = rows.slice(0, limit);
				return { events: page, ...(rows.length > limit ? { next: page.at(-1)!.id } : {}) };
			},
		},
		agents: { list: async () => agents },
	} as unknown as ConstructorParameters<typeof GroupIndex>[0];
}

const inbound = (id: string, conv: string, ts: string, text: string, extra: Record<string, unknown> = {}): Event => ({
	id,
	type: "message.in",
	ts,
	conv,
	from: "acct:qq:alice",
	data: { kind: "group", text, name: "alice", createdAt: "1793422669000", ...extra },
});

test("the same message in two Bots' groups merges into one room, with evidence", async () => {
	const index = await new GroupIndex(
		api([
			inbound("01", "conv:qq-main:group:A", "2026-10-31T04:57:40.785Z", "在吗"),
			inbound("02", "conv:qq-gpt:group:B", "2026-10-31T04:57:41.001Z", "在吗"),
		]),
	).build();
	const rooms = [...index.values()];
	expect(rooms).toHaveLength(1);
	expect(rooms[0]?.convs).toEqual(["conv:qq-gpt:group:B", "conv:qq-main:group:A"]);
	expect(rooms[0]?.instances).toEqual(["qq-gpt", "qq-main"]);
	expect(rooms[0]?.evidence.some((item) => item.kind === "message")).toBe(true);
	expect(GroupIndex.roomOf(index, "conv:qq-main:group:A")?.room).toBe(rooms[0]?.room);
});

test("different messages stay apart, and a merge needs a real fingerprint", async () => {
	const index = await new GroupIndex(
		api([
			inbound("01", "conv:qq-main:group:A", "2026-10-31T04:57:40.785Z", "在吗"),
			// 同一句正文但平台发送时间不同：不是同一条消息，不能合并。
			inbound("02", "conv:qq-gpt:group:B", "2026-10-31T04:57:41.001Z", "在吗", { createdAt: "1793422670000" }),
		]),
	).build();
	expect([...index.values()]).toHaveLength(2);
});

test("missing createdAt is never used as evidence", async () => {
	const index = await new GroupIndex(
		api([
			inbound("01", "conv:qq-main:group:A", "2026-10-31T04:57:40.785Z", "在吗", { createdAt: undefined }),
			inbound("02", "conv:qq-gpt:group:B", "2026-10-31T04:57:40.900Z", "在吗", { createdAt: undefined }),
		]),
	).build();
	expect([...index.values()]).toHaveLength(2);
});

test("people and speaking agents come from real events; a silent Bot is absent", async () => {
	const index = await new GroupIndex(
		api(
			[
				inbound("01", "conv:qq-main:group:A", "2026-10-31T04:57:40.785Z", "在吗"),
				{
					id: "02",
					type: "message.out",
					ts: "2026-10-31T04:57:41.000Z",
					conv: "conv:qq-main:group:A",
					from: "agent:main",
					data: { text: "在", delivery: { ok: true } },
				},
				// 投递失败不算发过言。
				{
					id: "03",
					type: "message.out",
					ts: "2026-10-31T04:57:42.000Z",
					conv: "conv:qq-main:group:A",
					from: "agent:gpt-senpai",
					data: { text: "在", delivery: { ok: false } },
				},
			],
			[
				{ id: "main", name: "贾维斯" },
				{ id: "gpt-senpai", name: "GPT 学姐" },
				{ id: "z-fish", name: "大肥鱼" },
			],
		),
	).build();
	const room = index.get("conv:qq-main:group:A");
	expect(room?.agents).toEqual([{ id: "main", name: "贾维斯" }]);
	expect(room?.people.map((person) => person.ref)).toEqual(["acct:qq:alice"]);
});

test("a configured room wins over fingerprint clustering", async () => {
	const index = new GroupIndex(
		api([
			inbound("01", "conv:qq-main:group:A", "2026-10-31T04:57:40.785Z", "在吗"),
			inbound("02", "conv:qq-gpt:group:B", "2026-10-31T04:57:41.001Z", "在吗"),
		]),
	);
	index.seed([["conv:qq-main:group:A"]]);
	const built = await index.build();
	// 配置把 A 固定成自己的房间；B 仍按指纹指向 A，所以两者依旧在一起，但房间 id 由配置决定。
	expect(GroupIndex.roomOf(built, "conv:qq-main:group:A")?.room).toBe("configured:0");
});
