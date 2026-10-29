import { href } from "../shell/routes";
import { breakpointOf } from "../shell/useBreakpoint";

/**
 * 开发用视图切换浮窗的纯逻辑：开关解析、断点预设、状态覆盖合并、主题与路由换算。
 * 这里不读 window / localStorage，输入都显式传入，方便单测；浏览器读写放在组件里。
 */

/** URL 参数名：?devtools=1 开启、?devtools=0 关闭。 */
export const DEVTOOLS_QUERY_KEY = "devtools";
/** localStorage 开关：值为 "1" 时启用。 */
export const DEVTOOLS_STORAGE_KEY = "yonder.devtools";

export interface DevtoolsSwitchInput {
	/** location.search，例如 "?devtools=1"。 */
	search?: string;
	/** localStorage 里的原始值；没有时为 null。 */
	stored?: string | null;
}

function queryParam(search: string | undefined, key: string): string | undefined {
	if (!search) return undefined;
	try {
		return new URLSearchParams(search).get(key) ?? undefined;
	} catch {
		return undefined;
	}
}

/**
 * 是否启用开发工具。URL 参数优先于 localStorage：只有 "1"/"0" 被识别，
 * 其它值忽略并回落到 localStorage。默认关闭。
 * 只读：不写存储，避免 iframe 预览（?devtools=0）悄悄改掉父页面的开关。
 */
export function readDevtoolsEnabled({ search, stored }: DevtoolsSwitchInput): boolean {
	const explicit = queryParam(search, DEVTOOLS_QUERY_KEY);
	if (explicit === "1") return true;
	if (explicit === "0") return false;
	return stored === "1";
}

/** 读本机开关；隐私模式或测试没有 localStorage 时按关闭处理。 */
export function storedDevtoolsEnabled(): string | null {
	try {
		return localStorage.getItem(DEVTOOLS_STORAGE_KEY);
	} catch {
		return null;
	}
}

export function storeDevtoolsEnabled(enabled: boolean): void {
	try {
		localStorage.setItem(DEVTOOLS_STORAGE_KEY, enabled ? "1" : "0");
	} catch {
		// 存储不可用时只在本次页面生效。
	}
}

/** 从路径查询和 hash 查询里都去掉 devtools 参数，保留其它参数与 hash。返回相对路径。 */
export function stripDevtoolsParam(url: string): string {
	const parsed = new URL(url, "http://localhost/");
	parsed.searchParams.delete(DEVTOOLS_QUERY_KEY);
	const hash = parsed.hash;
	const mark = hash.indexOf("?");
	if (mark !== -1) {
		const params = new URLSearchParams(hash.slice(mark + 1));
		params.delete(DEVTOOLS_QUERY_KEY);
		const rest = params.toString();
		parsed.hash = hash.slice(0, mark) + (rest ? `?${rest}` : "");
	}
	return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

/** 断点模拟页的地址：同一路由，但显式 devtools=0，避免模拟页里再套一层浮窗。 */
export function previewUrl(current: string): string {
	const parsed = new URL(current);
	parsed.searchParams.set(DEVTOOLS_QUERY_KEY, "0");
	return parsed.toString();
}

export type Breakpoint = ReturnType<typeof breakpointOf>;

/** 三档断点预设的尺寸（设计稿的常见机型）。 */
export const VIEWPORT_PRESETS = [
	{ id: "phone", label: "手机", width: 390, height: 844 },
	{ id: "tablet", label: "平板", width: 820, height: 1180 },
	{ id: "desktop", label: "桌面", width: 1280, height: 800 },
] as const;

export type ViewportId = (typeof VIEWPORT_PRESETS)[number]["id"];

export function viewportOf(id: ViewportId): (typeof VIEWPORT_PRESETS)[number] {
	const preset = VIEWPORT_PRESETS.find((item) => item.id === id);
	if (!preset) throw new Error(`未知断点预设：${id}`);
	return preset;
}

/** 预设宽度套用外壳同一套断点函数（useBreakpoint.breakpointOf），保证口径一致。 */
export function presetBreakpoint(id: ViewportId): Breakpoint {
	return breakpointOf(viewportOf(id).width);
}

export type ThemeChoice = "system" | "light" | "dark";

export const THEME_CHOICES: readonly { id: ThemeChoice; label: string }[] = [
	{ id: "system", label: "跟随系统" },
	{ id: "light", label: "亮" },
	{ id: "dark", label: "暗" },
] as const;

/** 主题选择 → 挂在 <html> 上的 data-devtools-theme 值；跟随系统时不挂。 */
export function themeAttribute(choice: ThemeChoice): "light" | "dark" | null {
	return choice === "system" ? null : choice;
}

export interface RouteJump {
	key: string;
	label: string;
	hash: string;
}

/** 固定路由快捷跳转；资料与群邀请需要 id，走下面的构造函数。 */
export const ROUTE_JUMPS: readonly RouteJump[] = [
	{ key: "chats", label: "消息", hash: href({ tab: "chats" }) },
	{ key: "contacts", label: "通讯录", hash: href({ tab: "contacts" }) },
	{ key: "work", label: "工作", hash: href({ tab: "work" }) },
	{ key: "me", label: "我", hash: href({ tab: "me" }) },
	{ key: "connect", label: "连接", hash: href({ tab: "chats", page: "connect" }) },
	{ key: "get", label: "安装", hash: href({ tab: "chats", page: "get" }) },
] as const;

/** #/u/:id 公开名片；空输入返回 undefined。 */
export function publicCardHash(id: string): string | undefined {
	const value = id.trim();
	return value ? href({ tab: "chats", page: "u", session: value }) : undefined;
}

/** #/g/:token 群邀请；空输入返回 undefined。 */
export function groupInviteHash(token: string): string | undefined {
	const value = token.trim();
	return value ? href({ tab: "chats", page: "g", session: value }) : undefined;
}

export type StateMode = "none" | "loading" | "empty" | "error";

export const STATE_MODES: readonly { id: StateMode; label: string }[] = [
	{ id: "none", label: "无" },
	{ id: "loading", label: "加载中" },
	{ id: "empty", label: "空" },
	{ id: "error", label: "错误" },
] as const;

export interface StateOverride {
	mode: StateMode;
}

export type StateOverridePatch = { mode?: StateMode };

export const NO_STATE_OVERRIDE: StateOverride = { mode: "none" };

export function isStateMode(value: unknown): value is StateMode {
	return value === "none" || value === "loading" || value === "empty" || value === "error";
}

/** 解析外部传入的状态名（例如以后从 URL 读）；未知值返回 undefined。 */
export function parseStateMode(value: string | null | undefined): StateMode | undefined {
	return isStateMode(value) ? value : undefined;
}

/**
 * 合并状态覆盖：后一层 patch 的 mode 覆盖前一层，undefined 或未知值跳过。
 * 界面一次只给一个 patch，保留逐层合并的语义便于以后叠加来源。
 */
export function mergeStateOverrides(
	base: StateOverride | undefined,
	...patches: (StateOverridePatch | undefined)[]
): StateOverride {
	let mode = base?.mode ?? NO_STATE_OVERRIDE.mode;
	for (const patch of patches) {
		const next = patch?.mode;
		if (next !== undefined && isStateMode(next)) mode = next;
	}
	return { mode };
}
