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
	const mk = (o: Partial<Parameters<typeof import("../src/work/lib/menus").taskRowMenu>[0]> = {}) => ({
		session: openTask,
		pinned: false,
		archived: false,
		open: noop,
		rename: noop,
		pin: noop,
		fork: noop,
		archive: noop,
		...o,
	});

	it("有打开、重命名、置顶、从这里分出、归档", async () => {
		const { taskRowMenu } = await import("../src/work/lib/menus");
		const items = taskRowMenu(mk());
		expect(items.map((i) => i.key)).toEqual(["open", "rename", "pin", "fork", "archive"]);
		expect(items.find((i) => i.key === "pin")?.label).toBe("置顶");
		expect(items.find((i) => i.key === "archive")?.label).toBe("归档");
	});

	it("已完成的任务显示恢复", async () => {
		const { taskRowMenu } = await import("../src/work/lib/menus");
		expect(taskRowMenu(mk({ session: closedTask, archived: true })).find((i) => i.key === "archive")?.label).toBe(
			"恢复到进行中",
		);
	});

	it("已置顶显示取消置顶，点选走调用方动作", async () => {
		const { taskRowMenu } = await import("../src/work/lib/menus");
		const pin = vi.fn();
		const item = taskRowMenu(mk({ pinned: true, pin })).find((i) => i.key === "pin");
		expect(item?.label).toBe("取消置顶");
		item?.onSelect();
		expect(pin.mock.calls.length).toBe(1);
	});

	it("重命名、分出、归档走调用方动作", async () => {
		const { taskRowMenu } = await import("../src/work/lib/menus");
		const rename = vi.fn();
		const fork = vi.fn();
		const archive = vi.fn();
		const items = taskRowMenu(mk({ rename, fork, archive }));
		for (const k of ["rename", "fork", "archive"]) items.find((i) => i.key === k)?.onSelect();
		expect([rename, fork, archive].map((f) => f.mock.calls.length)).toEqual([1, 1, 1]);
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
