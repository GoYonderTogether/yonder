import { parseHTML } from "linkedom";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { emptyView, reduce, type SessionView, useSession } from "../src/lib/useSession";

/**
 * 服务端 end 帧（contracts §2.2）直接喂给真实的 Mux + 假 socket，验证 useSession 的 onEnd 接线。
 * 没有 onEnd 时 forbidden/error 会让界面永远停在「连接中…」（ready 永远是 false）。
 */
const fake = vi.hoisted(() => {
	class FakeSocket {
		readyState = 0;
		sent: Array<Record<string, unknown>> = [];
		onopen: (() => void) | null = null;
		onmessage: ((event: MessageEvent) => void) | null = null;
		onclose: (() => void) | null = null;
		onerror: (() => void) | null = null;
		open() {
			this.readyState = 1;
			this.onopen?.();
		}
		feed(frame: unknown) {
			this.onmessage?.({ data: JSON.stringify(frame) } as MessageEvent);
		}
		send(data: string) {
			this.sent.push(JSON.parse(data) as Record<string, unknown>);
		}
		close() {
			this.readyState = 3;
			this.onclose?.();
		}
		subFrames() {
			return this.sent.filter((frame) => frame.t === "sub");
		}
	}
	const sockets: InstanceType<typeof FakeSocket>[] = [];
	return { FakeSocket, sockets };
});

vi.mock("../src/api/stream", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../src/api/stream")>();
	const mux = new actual.Mux({
		create: () => {
			const ws = new fake.FakeSocket();
			fake.sockets.push(ws);
			return ws;
		},
		url: () => "ws://gateway.test/api/stream?v=1",
	});
	return { ...actual, mux };
});

/** 挂载 useSession，返回本次挂载使用的连接与最新一帧视图。 */
async function mount(id = "s1") {
	const { window } = parseHTML("<html><body><div id='root'></div></body></html>");
	vi.stubGlobal("window", window);
	vi.stubGlobal("document", window.document);
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	const seen: SessionView[] = [];
	function Probe() {
		// 组件只记录 hook 的返回值，渲染断言用最新一帧。
		seen.push(useSession(id));
		return null;
	}
	const container = window.document.getElementById("root") as unknown as HTMLElement;
	const root = createRoot(container);
	await act(async () => root.render(createElement(Probe)));
	return {
		latest: () => seen[seen.length - 1] as SessionView,
		/** 本次挂载使用的连接；mux 是模块级单例，beforeEach 已 reset，所以总是最新那条。 */
		socketOf: () => fake.sockets[fake.sockets.length - 1],
		unmount: async () => {
			await act(async () => root.unmount());
		},
	};
}

/** 打开当前 socket、喂一帧 ready，再喂一帧 end；sub id 由 mux 生成，从已发帧里取。 */
async function endAfterReady(reason: string) {
	const view = await mount("s1");
	const socket = view.socketOf();
	if (!socket) throw new Error("no socket");
	await act(async () => socket.open());
	const sub = socket.subFrames()[0]?.sub;
	if (typeof sub !== "string") throw new Error("no sub frame");
	await act(async () => {
		socket.feed({
			t: "ready",
			sub,
			gap: false,
			cursor: "e1:0",
			result: {
				session: { id: "s1" },
				transcript: { items: [{ id: 1, kind: "pi.user", text: "你好" }], hasMore: false },
			},
		});
	});
	await act(async () => socket.feed({ t: "end", sub, reason }));
	return { view, socket, sub };
}

beforeEach(async () => {
	// mux 是模块级单例：清掉上一个用例的订阅与连接，每个用例从一条新连接开始。
	const { mux } = await import("../src/api/stream");
	mux.reset();
	fake.sockets.length = 0;
	// useSession 另有 sessions.show 元信息刷新；这里不需要网关。
	vi.stubGlobal(
		"fetch",
		vi.fn(() => Promise.reject(new Error("offline"))),
	);
});

describe("useSession 订阅被服务端 end", () => {
	it("forbidden 给出无权限提示，不再停在「连接中…」的无声状态", async () => {
		const { view, socket } = await endAfterReady("forbidden");

		expect(socket.subFrames()).toHaveLength(1);
		expect(view.latest().error).toBe("没有权限查看这个会话");
		// 已有数据不被 end 清掉
		expect(view.latest().items.map((i) => i.text)).toEqual(["你好"]);
		expect(view.latest().running).toBe(false);
		await view.unmount();
	});

	it("error 提示连接出错并保留数据；mux 用游标重订后 ready 到达即清除提示", async () => {
		const { view, socket, sub } = await endAfterReady("error");

		expect(view.latest().error).toBe("会话连接出错，正在重试…");
		expect(view.latest().items.map((i) => i.text)).toEqual(["你好"]);
		// contracts §2.4：error 由 mux 自动重订，重订带 after 游标。
		const resub = socket.subFrames()[1];
		expect(resub?.after).toBe("e1:0");

		await act(async () => {
			socket.feed({
				t: "ready",
				sub,
				gap: true,
				cursor: "e1:0",
				result: { session: { id: "s1" }, transcript: { items: [], hasMore: false } },
			});
		});
		expect(view.latest().error).toBeUndefined();
		await view.unmount();
	});

	it("其他 reason 提示并保留已有数据，不把原始 reason 直接显示", async () => {
		const { view } = await endAfterReady("shutdown");

		expect(view.latest().error).toBe("节点正在关闭，连接已断开");
		expect(view.latest().items.map((i) => i.text)).toEqual(["你好"]);
		await view.unmount();
	});
});

describe("useSession end 归约", () => {
	const loaded: SessionView = {
		...emptyView,
		ready: true,
		running: true,
		items: [{ id: "t1", role: "user", text: "旧消息", tools: [] }],
	};

	it("forbidden/error/shutdown 分别落到对应文案", () => {
		expect(reduce(loaded, { k: "end", reason: "forbidden" }).error).toBe("没有权限查看这个会话");
		expect(reduce(loaded, { k: "end", reason: "error" }).error).toBe("会话连接出错，正在重试…");
		expect(reduce(loaded, { k: "end", reason: "shutdown" }).error).toBe("节点正在关闭，连接已断开");
	});

	it("未知 reason 只给通用提示", () => {
		const next = reduce(loaded, { k: "end", reason: "slow-consumer" });
		expect(next.error).toBe("会话订阅已结束，已显示最后收到的内容");
		// 未知值不直接上屏
		expect(next.error).not.toContain("slow-consumer");
	});

	it("end 保留已有转录并停止运行态", () => {
		const next = reduce(loaded, { k: "end", reason: "closed" });
		expect(next.items).toBe(loaded.items);
		expect(next.session).toBe(loaded.session);
		expect(next.running).toBe(false);
	});

	it("只有流上真正到达的 ready 才清除 end 提示；sessions.show 的元信息刷新不清", () => {
		const ended = reduce(loaded, { k: "end", reason: "forbidden" });
		const meta = reduce(ended, {
			k: "snapshot",
			snap: { session: { id: "s1" } as SessionView["session"] },
			gap: false,
		});
		expect(meta.error).toBe("没有权限查看这个会话");

		const resumed = reduce(ended, {
			k: "snapshot",
			snap: { session: { id: "s1" } as SessionView["session"] },
			gap: false,
			stream: true,
		});
		expect(resumed.error).toBeUndefined();
	});
});
