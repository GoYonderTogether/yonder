import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
	vi.resetModules();
	const values = new Map<string, string>();
	vi.stubGlobal("localStorage", {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => values.set(key, value),
	});
});

describe("panel layout", () => {
	it.each([
		["todos", "待办"],
		["view:plugin.status", "插件状态"],
		["view:unknown", "unknown"],
	] as const)("titles %s", async (kind, title) => {
		const { panelTitle } = await import("../src/work/lib/layout");
		expect(panelTitle(kind, { "plugin.status": "插件状态" })).toBe(title);
	});

	it("loads the original persisted format and preserves it when saving", async () => {
		const saved = {
			rail: [{ id: "old", tabs: ["todos", "goal"], active: "goal" }],
			float: [{ id: "float", kind: "wake", x: 1, y: 2, collapsed: true }],
		};
		localStorage.setItem("yonder.layout.old", JSON.stringify(saved));
		const { getLayout, setLayout } = await import("../src/work/lib/layout");
		expect(getLayout("old")).toEqual(saved);
		setLayout("old", getLayout("old"));
		expect(JSON.parse(localStorage.getItem("yonder.layout.old") ?? "null")).toEqual(saved);
	});

	it("persists dynamic views in the same layout format", async () => {
		const { getLayout, toggleFloat } = await import("../src/work/lib/layout");
		toggleFloat("dynamic", "view:plugin.status");
		expect(getLayout("dynamic").float[0]?.kind).toBe("view:plugin.status");
		expect(JSON.parse(localStorage.getItem("yonder.layout.dynamic") ?? "null")).toEqual(getLayout("dynamic"));
	});
});
