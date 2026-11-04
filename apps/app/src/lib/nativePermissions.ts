/**
 * 原生权限（健康、日历等）申请入口。
 *
 * 只在 iOS 壳里可用：壳注入 window.__YONDER_SHELL__（contracts §17）与
 * __TAURI_INTERNALS__（Tauri 注入），命令由 apps/desktop/src-tauri/plugins/yonder-device
 * 提供（日历 / 提醒事项 / 通讯录 / 照片 / 位置 / 健康）。web 与桌面壳一律返回
 * unsupported，调用方据此整步跳过，不渲染假按钮。
 */
export type NativePermissionKind = "health" | "calendar";

/** 连接应用页列出的全部 iOS 能力 kind（与 Swift 端 KINDS 对齐）。 */
export type DeviceCapabilityKind = "calendar" | "reminders" | "contacts" | "photos" | "location" | "health";

export type NativePermissionResult =
	| { state: "granted" | "denied" | "prompt" }
	| { state: "unsupported"; reason: string };

interface TauriInternals {
	invoke(command: string, args?: unknown): Promise<unknown>;
}

declare global {
	interface Window {
		__YONDER_SHELL__?: string;
		__TAURI_INTERNALS__?: TauriInternals;
	}
}

const win = (): Window | undefined => (typeof window === "undefined" ? undefined : window);

/** 是否在注入了 Tauri 内核的客户端壳里运行（web 与桌面壳都不算）。 */
export function hasNativeShell(w: Window | undefined = win()): boolean {
	return !!w?.__YONDER_SHELL__ && !!w.__TAURI_INTERNALS__;
}

/** hasNativeShell 为真时 Tauri 内核一定在（两者同一次注入），这里收敛掉 undefined 分支。 */
function internals(w: Window | undefined): TauriInternals | undefined {
	return hasNativeShell(w) ? w?.__TAURI_INTERNALS__ : undefined;
}

function pluginUnavailable(reason: string): NativePermissionResult {
	return { state: "unsupported", reason };
}

function toPermissionResult(raw: unknown): NativePermissionResult {
	const state = (raw as { state?: unknown } | null | undefined)?.state;
	return state === "granted" || state === "denied" || state === "prompt"
		? { state }
		: { state: "unsupported", reason: "unexpected_plugin_response" };
}

/**
 * 申请一个原生权限：真实调 iOS 插件的 request，系统弹窗由用户点击；
 * 不在 iOS 壳里、或插件没注册（旧壳）时返回 unsupported，不伪装结果。
 */
export async function requestNativePermission(kind: NativePermissionKind): Promise<NativePermissionResult> {
	const tauri = internals(win());
	if (!tauri) return pluginUnavailable("native_shell_missing");
	try {
		return toPermissionResult(await tauri.invoke("plugin:yonder-device|request", { kind }));
	} catch {
		return pluginUnavailable("yonder_device_plugin_missing");
	}
}

/** 读一个 kind 的当前授权状态，不触发弹窗。 */
export async function nativePermissionStatus(kind: DeviceCapabilityKind): Promise<NativePermissionResult> {
	const tauri = internals(win());
	if (!tauri) return pluginUnavailable("native_shell_missing");
	try {
		return toPermissionResult(await tauri.invoke("plugin:yonder-device|status", { kind }));
	} catch {
		return pluginUnavailable("yonder_device_plugin_missing");
	}
}

function shellInvoke(command: string, args?: unknown): Promise<unknown> {
	const tauri = internals(win());
	if (!tauri) return Promise.reject(new Error("native_shell_missing"));
	return tauri.invoke(command, args);
}

/** 日历事件（Unix 秒闭区间）；未授权或不在 iOS 壳里时抛错，由调用方如实展示。 */
export function readCalendarEvents(from: number, to: number): Promise<unknown> {
	return shellInvoke("plugin:yonder-device|calendar_events", { from, to });
}

/** 提醒事项列表。 */
export function readReminders(): Promise<unknown> {
	return shellInvoke("plugin:yonder-device|reminders");
}

/** 通讯录（姓名 + 电话 / 邮箱）。 */
export function readContacts(): Promise<unknown> {
	return shellInvoke("plugin:yonder-device|contacts");
}

/** 照片授权状态（不读相册内容）。 */
export async function photosStatus(): Promise<NativePermissionResult> {
	const tauri = internals(win());
	if (!tauri) return pluginUnavailable("native_shell_missing");
	try {
		return toPermissionResult(await tauri.invoke("plugin:yonder-device|photos_status"));
	} catch {
		return pluginUnavailable("yonder_device_plugin_missing");
	}
}

/** 当前位置（when-in-use）。 */
export function readLocation(): Promise<unknown> {
	return shellInvoke("plugin:yonder-device|location");
}

/** 健康：最近 7 天步数 / 睡眠 / 心率。 */
export function readHealth(): Promise<unknown> {
	return shellInvoke("plugin:yonder-device|health");
}
