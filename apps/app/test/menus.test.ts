import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Actor } from "../src/work/api/social/types";
import type { SessionInfo } from "../src/work/api/types";

const base: SessionInfo = {
	id: "s1",
	agent: null,
	profile: "default",
	mode: "task",
	key: "",
	version: "1",
	opened: "",
};
const openTask: SessionInfo = { ...base };
const closedTask: SessionInfo = { ...base, closed: "2026-10-28T10:00:00.000Z" };
const actor: Actor = { id: "a1", kind: "human", name: "Alice" };

const noop = () => {};

beforeEach(() => {
	vi.resetModules();
	const values = new Map<string, string>();
	vi.stubGlobal("localStorage", {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => values.set(key, value),
	});
	vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn(async () => {}) } });
});

describe("botRowMenu", () => {
	it("打开会话与复制标题，复制写入剪贴板", async () => {
		const { botRowMenu } = await import("../src/work/lib/menus");
		const open = vi.fn();
		const items = botRowMenu({ title: "主 Bot", open });
		expect(items.map((i) => i.key)).toEqual(["open", "copy"]);
		items[0]?.onSelect();
		expect(open).toHaveBeenCalledOnce();
		items[1]?.onSelect();
		expect(navigator.clipboard.writeText).toHaveBeenCalledWith("主 Bot");
	});
});

describe("taskRowMenu", () => {
	it("打开中的任务有打开、关闭、置顶三项", async () => {
		const { taskRowMenu } = await import("../src/work/lib/menus");
		const items = taskRowMenu({ session: openTask, pinned: false, open: noop, close: noop });
		expect(items.map((i) => i.key)).toEqual(["open", "close", "pin"]);
		expect(items.find((i) => i.key === "pin")?.label).toBe("置顶");
	});

	it("已关闭的任务不显示关闭项", async () => {
		const { taskRowMenu } = await import("../src/work/lib/menus");
		const items = taskRowMenu({ session: closedTask, pinned: false, open: noop, close: noop });
		expect(items.map((i) => i.key)).toEqual(["open", "pin"]);
	});

	it("已置顶的任务显示取消置顶，点选写回 prefs", async () => {
		const { taskRowMenu } = await import("../src/work/lib/menus");
		const items = taskRowMenu({ session: openTask, pinned: true, open: noop, close: noop });
		const pin = items.find((i) => i.key === "pin");
		expect(pin?.label).toBe("取消置顶");
		pin?.onSelect();
		expect(JSON.parse(localStorage.getItem("yonder.prefs") ?? "{}").pinned).toEqual(["s1"]);
	});

	it("关闭项走调用方给的关闭动作", async () => {
		const { taskRowMenu } = await import("../src/work/lib/menus");
		const close = vi.fn();
		taskRowMenu({ session: openTask, pinned: false, open: noop, close })[1]?.onSelect();
		expect(close).toHaveBeenCalledOnce();
	});
});

describe("panelMenu", () => {
	it("右栏卡片只有弹出悬浮窗", async () => {
		const { panelMenu } = await import("../src/work/lib/menus");
		const items = panelMenu({ session: "s1", placement: "rail", kind: "todos" });
		expect(items.map((i) => i.key)).toEqual(["float"]);
		items[0]?.onSelect();
		const { getLayout } = await import("../src/work/lib/layout");
		expect(getLayout("s1").float.map((f) => f.kind)).toEqual(["todos"]);
	});

	it("悬浮窗可停靠回右栏并收起", async () => {
		const { panelMenu } = await import("../src/work/lib/menus");
		const toggle = vi.fn();
		const items = panelMenu({ session: "s1", placement: "floating", kind: "context", onToggleCollapse: toggle });
		expect(items.map((i) => i.key)).toEqual(["dock", "collapse"]);
		expect(items[1]?.label).toBe("收起");
		items[0]?.onSelect();
		const { getLayout } = await import("../src/work/lib/layout");
		expect(getLayout("s1").rail[0]?.tabs).toEqual(["context"]);
		items[1]?.onSelect();
		expect(toggle).toHaveBeenCalledOnce();
	});

	it("已收起的悬浮窗显示展开；没有收起回调时不造收起项", async () => {
		const { panelMenu } = await import("../src/work/lib/menus");
		expect(
			panelMenu({ session: "s1", placement: "floating", kind: "context", collapsed: true, onToggleCollapse: noop })[1]
				?.label,
		).toBe("展开");
		expect(panelMenu({ session: "s1", placement: "floating", kind: "context" }).map((i) => i.key)).toEqual(["dock"]);
	});
});
