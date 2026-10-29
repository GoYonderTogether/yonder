import type { breakpointOf } from "./useBreakpoint";

/**
 * 断点 → 布局模式的纯函数，不读窗口、不碰 React。
 * 断点口径与 shell/useBreakpoint.ts 的 breakpointOf 一致：phone <640、tablet 640–1024、desktop >1024
 * （page-tree.md §2 断点表）。
 */
export type Breakpoint = ReturnType<typeof breakpointOf>;

/** 导航：手机底栏，平板与桌面左侧图标栏。 */
export type NavMode = "tabbar" | "iconrail";
/**
 * 内容列（左侧图标栏由 nav 描述，不计入）：手机只有主区；平板第二列与主区并存、按需叠成覆盖层
 * （list=stacked）；桌面列表、主区与可停靠的右栏常驻。
 */
export type Columns = "single" | "list+main" | "list+main+rail";
/** 右栏：手机全屏抽屉，平板按需覆盖层，桌面常驻可调宽。 */
export type RailMode = "drawer" | "overlay" | "docked";
/** 第二列：手机与主区互斥，平板按需叠加（覆盖层），桌面常驻。 */
export type ListMode = "screen" | "stacked" | "docked";

export interface LayoutMode {
	nav: NavMode;
	columns: Columns;
	rail: RailMode;
	list: ListMode;
}

const LAYOUTS: Record<Breakpoint, LayoutMode> = {
	phone: { nav: "tabbar", columns: "single", rail: "drawer", list: "screen" },
	tablet: { nav: "iconrail", columns: "list+main", rail: "overlay", list: "stacked" },
	desktop: { nav: "iconrail", columns: "list+main+rail", rail: "docked", list: "docked" },
};

/** 断点 → 布局能力；纯函数，不读窗口。 */
export function layoutMode(bp: Breakpoint): LayoutMode {
	return LAYOUTS[bp];
}

/** 主区当前是哪一类页：列表、会话、设置（「我」）、其它功能页（名片、会话详情等）。 */
export type Screen = "list" | "session" | "settings" | "page";
/** 第二列的去向：常驻列、占满主区、覆盖层、不显示。 */
export type Side = "column" | "main" | "overlay" | "none";

/** 外壳一次渲染的布局决定，供 Shell 与测试共用。 */
export interface ShellFrame {
	mode: LayoutMode;
	/** 底部标签栏：手机列表与设置页出现；会话与功能页整屏，让位给内容。 */
	tabBar: boolean;
	/** Chat 以桌面宽屏渲染（右栏停靠）；平板与手机交给 Chat 自己的右栏抽屉。 */
	chatWide: boolean;
	/** 第二列：桌面常驻列；列表在手机与设置都占满主区；平板列表为覆盖层、设置同样落在主区。 */
	side: Side;
}

/**
 * 断点 × 页型 → 外壳帧，把「按需叠加」落成具体去向：
 * 桌面第二列常驻；手机列表与设置占满主区；平板列表是覆盖层，打开会话或功能页即收起。
 */
export function frameOf(bp: Breakpoint, screen: Screen): ShellFrame {
	const mode = layoutMode(bp);
	return {
		mode,
		tabBar: mode.nav === "tabbar" && (screen === "list" || screen === "settings"),
		chatWide: mode.rail === "docked",
		side: sideOf(mode, screen),
	};
}

/**
 * 第二列去向：桌面常驻（设置也在这一列）。列表按断点在手机占满主区、在平板叠成覆盖层；
 * 设置由外壳的 side 渲染，手机与平板都落在主区；会话与其它功能页整屏，不给第二列。
 */
function sideOf(mode: LayoutMode, screen: Screen): Side {
	if (mode.list === "docked") return "column";
	if (screen === "list") return mode.list === "screen" ? "main" : "overlay";
	return screen === "settings" ? "main" : "none";
}
