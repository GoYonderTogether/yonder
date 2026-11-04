import { describe, expect, it, vi } from "vitest";
import {
	hasNativeShell,
	nativePermissionStatus,
	requestNativePermission,
} from "../src/lib/nativePermissions";

describe("nativePermissions", () => {
	it("没有壳注入时一律返回 unsupported，不触任何调用", async () => {
		expect(hasNativeShell(undefined)).toBe(false);
		expect(await requestNativePermission("health")).toEqual({
			state: "unsupported",
			reason: "native_shell_missing",
		});
		expect(await nativePermissionStatus("calendar")).toEqual({
			state: "unsupported",
			reason: "native_shell_missing",
		});
	});

	it("只有壳标记、没有 Tauri 内核时也算壳外（桌面壳不暴露这些能力）", () => {
		const win = { __YONDER_SHELL__: "desktop" } as unknown as Window & { __TAURI_INTERNALS__?: unknown };
		expect(hasNativeShell(win)).toBe(false);
	});

	it("壳标记与 Tauri 内核同时在才算壳内", () => {
		const win = {
			__YONDER_SHELL__: "mobile",
			__TAURI_INTERNALS__: { invoke: () => Promise.resolve({ state: "granted" }) },
		} as unknown as Window;
		expect(hasNativeShell(win)).toBe(true);
	});

	it("插件响应的 state 白名单外按 unsupported 处理，不猜测", async () => {
		const win = {
			__YONDER_SHELL__: "mobile",
			__TAURI_INTERNALS__: { invoke: () => Promise.resolve({ state: "maybe" }) },
		} as unknown as Window;
		vi.stubGlobal("window", win);
		expect(await nativePermissionStatus("health")).toEqual({
			state: "unsupported",
			reason: "unexpected_plugin_response",
		});
		vi.unstubAllGlobals();
	});

	it("插件调用失败（旧壳没有 yonder-device）返回 unsupported 而不是抛错", async () => {
		const win = {
			__YONDER_SHELL__: "mobile",
			__TAURI_INTERNALS__: { invoke: () => Promise.reject(new Error("not allowed")) },
		} as unknown as Window;
		vi.stubGlobal("window", win);
		expect(await requestNativePermission("calendar")).toEqual({
			state: "unsupported",
			reason: "yonder_device_plugin_missing",
		});
		vi.unstubAllGlobals();
	});
});
