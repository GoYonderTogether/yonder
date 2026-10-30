import { describe, expect, it } from "vitest";
import type { SessionSnapshot } from "../src/work/api/types";
import { emptyView, reduce, type SessionView } from "../src/work/lib/useSession";

// 上一轮连接留下的本地增量：gap 之后这些都不作数。
const stale: SessionView = {
	...emptyView,
	ready: true,
	running: true,
	session: { id: "s1" } as SessionView["session"],
	items: [{ id: "t1", role: "user", text: "旧消息", tools: [] }],
	hasMore: true,
	model: { provider: "openai", model: "gpt-6-luna" },
	usage: { self: { input: 1, output: 2 } } as SessionView["usage"],
	context: { tokens: 10 } as SessionView["context"],
	todos: [{ id: "t", text: "旧待办", status: "pending" } as SessionView["todos"][number]],
	subtasks: [{ id: "sub" } as SessionView["subtasks"][number]],
	background: [{ id: "bg" } as SessionView["background"][number]],
	error: "旧的报错",
};

describe("useSession reduce 快照", () => {
	it("gap=true 丢掉本地增量，只按快照重建", () => {
		const snap: SessionSnapshot = {
			session: { id: "s1" } as SessionSnapshot["session"],
			transcript: { items: [{ id: 7, kind: "pi.user", text: "重来" }], hasMore: false },
		};
		const next = reduce(stale, { k: "snapshot", snap, gap: true });

		expect(next.ready).toBe(true);
		expect(next.items.map((i) => i.text)).toEqual(["重来"]);
		expect(next.hasMore).toBe(false);
		// 快照没给的字段一律回落到空，而不是沿用旧连接的增量
		expect(next.model).toBeUndefined();
		expect(next.usage).toBeUndefined();
		expect(next.context).toBeUndefined();
		expect(next.todos).toEqual([]);
		expect(next.subtasks).toEqual([]);
		expect(next.background).toEqual([]);
		expect(next.error).toBeUndefined();
	});

	it("gap=true 且快照没有 transcript 时清空消息，不留旧 transcript", () => {
		const next = reduce(stale, {
			k: "snapshot",
			snap: { session: { id: "s1" } as SessionSnapshot["session"] },
			gap: true,
		});

		expect(next.items).toEqual([]);
		expect(next.hasMore).toBe(false);
	});

	it("gap=false 保留本地增量（sessions.show 的元信息刷新不算 gap）", () => {
		const next = reduce(stale, {
			k: "snapshot",
			snap: { session: { id: "s1" } as SessionSnapshot["session"] },
			gap: false,
		});

		expect(next.items).toEqual(stale.items);
		expect(next.hasMore).toBe(true);
		expect(next.todos).toEqual(stale.todos);
		expect(next.error).toBe("旧的报错");
	});

	it("gap=true 时快照给出的字段照常采用", () => {
		const snap: SessionSnapshot = {
			session: { id: "s1" } as SessionSnapshot["session"],
			model: { provider: "openai", model: "gpt-6-luna", contextWindow: 400000 },
			usage: { self: { input: 3, output: 4 } },
			context: { tokens: 99 } as SessionSnapshot["context"],
			transcript: { items: [], hasMore: false },
		};
		const next = reduce(stale, { k: "snapshot", snap, gap: true });

		expect(next.model).toMatchObject({ provider: "openai", model: "gpt-6-luna", contextWindow: 400000 });
		expect(next.usage).toMatchObject({ self: { input: 3, output: 4 } });
		expect(next.context).toMatchObject({ tokens: 99 });
	});

	it("gap 重建时读取真实 Gateway ready 的 info，同时保留外层 session 和 transcript", () => {
		const snap = {
			session: { id: "s1" },
			info: {
				model: { provider: "openai", id: "gpt-6-luna" },
				usage: { input: 15064, output: 6 },
				config: { resolved: { thinking: "high" } },
			},
			transcript: { items: [{ id: 9, kind: "pi.user", text: "当前消息" }], hasMore: false },
		} as unknown as SessionSnapshot;
		const next = reduce(stale, { k: "snapshot", snap, gap: true, stream: true });
		expect(next.model).toMatchObject({ provider: "openai", model: "gpt-6-luna", thinking: "high" });
		expect(next.usage?.self).toMatchObject({ input: 15064, output: 6 });
		expect(next.session?.id).toBe("s1");
		expect(next.items.map((item) => item.text)).toEqual(["当前消息"]);
	});
});
