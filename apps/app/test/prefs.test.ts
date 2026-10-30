import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
	vi.resetModules();
	const values = new Map<string, string>();
	vi.stubGlobal("localStorage", {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => values.set(key, value),
	});
});

describe("notification preferences", () => {
	it.each([
		[undefined, true, "all"],
		["all", true, "all"],
		["mentions", true, "mentions"],
		["mute", true, "mute"],
		["all", false, "mute"],
		["mentions", false, "mute"],
		[undefined, false, "mute"],
	] as const)("resolves %s with enabled=%s", async (conv, enabled, expected) => {
		const { effectiveLevel } = await import("../src/work/lib/prefs");
		expect(effectiveLevel(conv, { enabled, vibrate: true, previews: true })).toBe(expected);
	});

	it("migrates old levels without losing other preferences", async () => {
		localStorage.setItem(
			"yonder.prefs",
			JSON.stringify({ pinned: ["a"], level: { a: "mention", b: "mute" }, read: { a: 42 } }),
		);
		const { setNotifyPrefs } = await import("../src/work/lib/prefs");
		setNotifyPrefs({ vibrate: false });
		expect(JSON.parse(localStorage.getItem("yonder.prefs") ?? "null")).toEqual({
			level: { a: "mentions", b: "mute" },
			read: { a: 42 },
			// 置顶（网页会话）沿用同一个键，旧值原样保留。
			pinned: ["a"],
			notify: { enabled: true, vibrate: false, previews: true },
		});
	});
});
