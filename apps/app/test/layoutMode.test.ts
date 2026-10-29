import { describe, expect, it } from "vitest";
import { frameOf, layoutMode, type Screen } from "../src/work/shell/layoutMode";
import { breakpointOf } from "../src/work/shell/useBreakpoint";

const SCREENS: Screen[] = ["list", "session", "settings", "page"];

describe("breakpoint → layout mode", () => {
	it.each([
		[360, "phone"],
		[639, "phone"],
		[640, "tablet"],
		[820, "tablet"],
		[1024, "tablet"],
		[1025, "desktop"],
		[1280, "desktop"],
		[1920, "desktop"],
	] as const)("%i is %s", (width, bp) => {
		expect(breakpointOf(width)).toBe(bp);
		expect(layoutMode(breakpointOf(width))).toEqual(layoutMode(bp));
	});

	it("phone: bottom tab bar, single column, right rail as a drawer", () => {
		expect(layoutMode("phone")).toEqual({ nav: "tabbar", columns: "single", rail: "drawer", list: "screen" });
	});

	it("tablet: icon rail + main area, second column and right rail on demand", () => {
		expect(layoutMode("tablet")).toEqual({ nav: "iconrail", columns: "list+main", rail: "overlay", list: "stacked" });
	});

	it("desktop: icon rail + list + main, right rail docked", () => {
		expect(layoutMode("desktop")).toEqual({
			nav: "iconrail",
			columns: "list+main+rail",
			rail: "docked",
			list: "docked",
		});
	});
});

describe("breakpoint × screen → shell frame", () => {
	// 宽, 页型, 导航, 底栏, 宽屏 Chat, 第二列
	it.each([
		[390, "list", "tabbar", true, false, "main"],
		[390, "session", "tabbar", false, false, "none"],
		[390, "settings", "tabbar", true, false, "main"],
		[390, "page", "tabbar", false, false, "none"],
		[360, "list", "tabbar", true, false, "main"],
		[820, "list", "iconrail", false, false, "overlay"],
		[820, "session", "iconrail", false, false, "none"],
		[820, "settings", "iconrail", false, false, "main"],
		[820, "page", "iconrail", false, false, "none"],
		[1024, "list", "iconrail", false, false, "overlay"],
		[1024, "session", "iconrail", false, false, "none"],
		[1024, "settings", "iconrail", false, false, "main"],
		[1024, "page", "iconrail", false, false, "none"],
		[1280, "list", "iconrail", false, true, "column"],
		[1280, "session", "iconrail", false, true, "column"],
		[1280, "settings", "iconrail", false, true, "column"],
		[1920, "page", "iconrail", false, true, "column"],
	] as const)("%i on %s uses %s, tabBar=%s, chatWide=%s, side=%s", (width, screen, nav, tabBar, chatWide, side) => {
		const frame = frameOf(breakpointOf(width), screen);
		expect(frame.mode.nav).toBe(nav);
		expect({ tabBar: frame.tabBar, chatWide: frame.chatWide, side: frame.side }).toEqual({ tabBar, chatWide, side });
	});

	it("covers every breakpoint × screen combination", () => {
		for (const bp of ["phone", "tablet", "desktop"] as const) {
			for (const screen of SCREENS) expect(frameOf(bp, screen).mode).toEqual(layoutMode(bp));
		}
	});

	it("does not fall back to the phone layout on tablet", () => {
		for (const screen of SCREENS) {
			const frame = frameOf("tablet", screen);
			expect(frame.mode.nav).toBe("iconrail");
			expect(frame.tabBar).toBe(false);
		}
	});

	it("does not dock the rail or three columns early at 1024", () => {
		for (const screen of SCREENS) {
			const frame = frameOf(breakpointOf(1024), screen);
			expect(frame.chatWide).toBe(false);
			expect(frame.side).not.toBe("column");
			expect(frame.mode.rail).toBe("overlay");
		}
	});

	it("keeps the tablet list as an overlay that yields to chat and pages", () => {
		expect(frameOf("tablet", "list").side).toBe("overlay");
		for (const screen of ["session", "page"] as const) expect(frameOf("tablet", screen).side).toBe("none");
	});

	it("keeps the phone tab bar on the list and settings pages", () => {
		expect(frameOf("phone", "list").tabBar).toBe(true);
		expect(frameOf("phone", "settings").tabBar).toBe(true);
		for (const screen of ["session", "page"] as const) {
			expect(frameOf("phone", screen).tabBar).toBe(false);
		}
	});
});
