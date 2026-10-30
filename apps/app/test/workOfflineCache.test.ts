import { QueryClient } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import {
	clearWorkCache,
	hasWorkCache,
	readWorkView,
	reconcileWorkDevices,
	reconcileWorkSessions,
	restoreAllWork,
	restoreWorkQueries,
	saveAllWork,
	saveWorkQueries,
	saveWorkView,
	updateStoredWork,
} from "../src/work/lib/offlineCache";
import { deviceOnline, setWorkDevices } from "../src/work/lib/workOnline";

function storage() {
	const data: Record<string, string> = {};
	return new Proxy(
		{
			getItem: (key: string) => data[key] ?? null,
			setItem: (key: string, value: string) => {
				data[key] = value;
			},
			removeItem: (key: string) => {
				delete data[key];
			},
		},
		{
			ownKeys: () => Reflect.ownKeys(data),
			getOwnPropertyDescriptor: () => ({ configurable: true, enumerable: true }),
		},
	);
}
afterEach(() => {
	vi.unstubAllGlobals();
});
it("缓存按账号设备隔离，解绑后清除，退出后不保留", () => {
	vi.stubGlobal("sessionStorage", storage());
	const client = new QueryClient();
	client.setQueryData(["sessions", "work"], [{ id: "s1" }]);
	client.setQueryData(["device-agents", "account:a:device:d1"], [{ key: "main" }]);
	client.setQueryData(["device-agents", "account:a:device:d2"], [{ key: "other" }]);
	client.setQueryData(["all-work", "a", "d1", "sessions"], [{ id: "s1" }]);
	saveWorkQueries(client, "a", "d1");
	saveAllWork(client, "a");
	saveWorkView("a", "d1", "s1", { items: ["loaded"] });
	updateStoredWork("a", "d1", "agents", [{ key: "new" }]);
	const restored = new QueryClient();
	restoreWorkQueries(restored, "a", "d1");
	expect(restored.getQueryData(["sessions", "work"])).toEqual([{ id: "s1" }]);
	expect(restored.getQueryData(["device-agents", "account:a:device:d1"])).toEqual([{ key: "new" }]);
	expect(restored.getQueryData(["device-agents", "account:a:device:d2"])).toBeUndefined();
	expect(readWorkView("b", "d1", "s1")).toBeNull();
	const other = new QueryClient();
	restoreAllWork(other, "a", []);
	expect(other.getQueryData(["all-work", "a", "d1", "sessions"])).toBeUndefined();
	reconcileWorkDevices("a", []);
	expect(readWorkView("a", "d1", "s1")).toBeNull();
	clearWorkCache();
	expect(hasWorkCache("a", "d1")).toBe(false);
});
it("只把已确认在线且支持工作台的云设备视为可写", () => {
	setWorkDevices([
		{ id: "a", online: true, workProtocol: 1 },
		{ id: "b", online: false },
		{ id: "c", online: true },
	]);
	expect(deviceOnline("a")).toBe(true);
	expect(deviceOnline("b")).toBe(false);
	expect(deviceOnline("c")).toBe(false);
	expect(deviceOnline("missing")).toBe(false);
	expect(deviceOnline()).toBe(true);
});

it("只有权威会话或 Bot 名册确认移除时才驱逐对应窗口", () => {
	vi.stubGlobal("sessionStorage", storage());
	saveWorkView("a", "d", "s1", { session: { id: "s1", mode: "main", agent: "bot" }, items: ["old"] });
	reconcileWorkSessions("a", "d", ["s1"]);
	expect(readWorkView("a", "d", "s1")).not.toBeNull();
	reconcileWorkSessions("a", "d", undefined, []);
	expect(readWorkView("a", "d", "s1")).toBeNull();
	saveWorkView("a", "d", "s2", { session: { id: "s2", mode: "task" }, items: ["other"] });
	expect(readWorkView("a", "d", "s2")).not.toBeNull();
	reconcileWorkSessions("a", "d", []);
	expect(readWorkView("a", "d", "s2")).toBeNull();
});
