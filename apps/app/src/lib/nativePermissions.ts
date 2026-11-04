/**
 * 原生权限（健康、日历等）申请入口。
 *
 * iOS 壳的原生插件还没有实现：这里只认壳注入的 window.__YONDER_SHELL__
 * （contracts §17，"desktop" | "mobile"）加 __TAURI_INTERNALS__（Tauri 注入），
 * 其余环境一律返回 unsupported，调用方据此整步跳过，不渲染假按钮。
 * 插件落地后由负责人在这里接 plugin:permissions|request 之类的真实调用。
 */
export type NativePermissionKind = "health" | "calendar";

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

/**
 * 申请一个原生权限。现在唯一真实的返回是 unsupported：
 * 原生插件没建好，不在 iOS 壳里或没有插件都走到这一支，
 * 引导流程据此跳过整个「授权」步骤。
 */
export async function requestNativePermission(kind: NativePermissionKind): Promise<NativePermissionResult> {
	const w = win();
	if (!hasNativeShell(w)) return { state: "unsupported", reason: "native_shell_missing" };
	// 插件落地前的固定结果：接口先立住，调用方按 unsupported 处理。
	void kind;
	return { state: "unsupported", reason: "native_permission_plugin_unavailable" };
}
