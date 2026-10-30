import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { $session } from "../src/store";
import { WorkApp } from "../src/work/WorkApp";

const deviceState = vi.hoisted(() => ({
	devices: [] as Array<{ id: string; name: string; kind: "desktop"; online: boolean; workProtocol?: 1 }>,
	error: null as Error | null,
}));
vi.mock("radix-ui", () => ({
	DropdownMenu: {
		Root: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
		Trigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
		Portal: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
		Content: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
		RadioGroup: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
		RadioItem: ({ children, onSelect }: { children: React.ReactNode; onSelect(): void }) => (
			<button type="button" onClick={onSelect}>
				{children}
			</button>
		),
		ItemIndicator: () => null,
	},
}));
vi.mock("../src/api", () => ({
	api: {
		devices: () => (deviceState.error ? Promise.reject(deviceState.error) : Promise.resolve(deviceState.devices)),
	},
}));
vi.mock("../src/work/lib/queries", () => ({
	useFacts: () => ({ data: { protocol: 1 } }),
	deviceAgentMap: () => new Map(),
	fetchDeviceAgents: async () => [],
}));
vi.mock("../src/work/WorkShell", () => ({
	WorkShell: ({ device }: { device?: React.ReactNode }) => <div>{device}真实工作入口</div>,
}));
vi.mock("../src/components/PersonalDrawer", () => ({ PersonalAvatar: () => null }));
afterEach(() => {
	$session.set(undefined);
	deviceState.error = null;
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
});

function CurrentPath() {
	return <output>{useLocation().pathname}</output>;
}

async function render(path = "/work") {
	vi.stubEnv("VITE_API", "http");
	const { document, window } = parseHTML("<html><body></body></html>");
	vi.stubGlobal("window", window);
	vi.stubGlobal("document", document);
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	$session.set({ actor: { id: "owner", kind: "human", name: "Owner" } });
	const container = document.createElement("div") as unknown as HTMLElement;
	const root = createRoot(container);
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	await act(async () =>
		root.render(
			<QueryClientProvider client={client}>
				<MemoryRouter initialEntries={[path]}>
					<WorkApp />
					<CurrentPath />
				</MemoryRouter>
			</QueryClientProvider>,
		),
	);
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 30));
	});
	return { container, root, client };
}

it("无设备提供连接和安装入口，不要求第二次授权", async () => {
	deviceState.devices = [];
	const { container, root } = await render();
	expect(container.textContent).toContain("连接设备后即可开始工作");
	expect(container.innerHTML).toContain('href="/connect"');
	expect(container.innerHTML).toContain('href="/get"');
	expect(container.textContent).not.toContain("令牌");
	await act(() => root.unmount());
});

it("离线与旧版设备分别提示，唯一可用设备自动进入", async () => {
	deviceState.devices = [
		{ id: "a", name: "离线设备", kind: "desktop", online: false },
		{ id: "b", name: "旧设备", kind: "desktop", online: true },
	];
	const first = await render();
	expect(first.container.textContent).toContain("离线");
	expect(first.container.textContent).toContain("需要更新 Yonder");
	await act(() => first.root.unmount());
	deviceState.devices = [{ id: "c", name: "可用设备", kind: "desktop", online: true, workProtocol: 1 }];
	const second = await render();
	expect(second.container.textContent).toContain("真实工作入口");
	const { activeNode } = await import("../src/work/api/nodes");
	expect(activeNode().id).toBe("account:owner:device:c");
	await act(() => second.root.unmount());
});

it("首次进入保留任务深链，切换设备回到列表", async () => {
	const { setActiveNode } = await import("../src/work/api/nodes");
	setActiveNode("local");
	deviceState.devices = [{ id: "first", name: "第一台", kind: "desktop", online: true, workProtocol: 1 }];
	const { container, root, client } = await render("/work/161097");
	expect(container.querySelector("output")?.textContent).toBe("/work/161097");
	await act(async () => {
		client.setQueryData(
			["account-devices", "owner"],
			[...deviceState.devices, { id: "second", name: "第二台", kind: "desktop", online: true, workProtocol: 1 }],
		);
		await new Promise((resolve) => setTimeout(resolve, 20));
	});
	const target = [...container.querySelectorAll("button")].find((b) => b.textContent?.includes("第二台"));
	const key = Object.keys(target ?? {}).find((k) => k.startsWith("__reactProps$")) ?? "";
	await act(async () => (target as unknown as Record<string, { onClick(): void }>)[key]?.onClick());
	expect(container.querySelector("output")?.textContent).toBe("/work");
	await act(() => root.unmount());
});

it("旧任务深链没有设备时，选择其设备仍保留任务", async () => {
	const { setActiveNode } = await import("../src/work/api/nodes");
	setActiveNode("local");
	deviceState.devices = [
		{ id: "first", name: "第一台", kind: "desktop", online: true, workProtocol: 1 },
		{ id: "second", name: "第二台", kind: "desktop", online: true, workProtocol: 1 },
	];
	const { container, root } = await render("/work/161097");
	expect(container.textContent).toContain("请选择这个会话所在的设备");
	const target = [...container.querySelectorAll("button")].find((b) => b.textContent?.includes("第一台"));
	const key = Object.keys(target ?? {}).find((k) => k.startsWith("__reactProps$")) ?? "";
	await act(async () => (target as unknown as Record<string, { onClick(): void }>)[key]?.onClick());
	expect(container.querySelector("output")?.textContent).toBe("/work/device/first/161097");
	await act(() => root.unmount());
});

it("刷新时设备读取失败可恢复缓存；没有缓存时明确报错", async () => {
	const data: Record<string, string> = {};
	vi.stubGlobal(
		"sessionStorage",
		new Proxy(
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
		),
	);
	const { saveWorkDevices, saveWorkQueries, clearWorkCache } = await import("../src/work/lib/offlineCache");
	const { setActiveNode } = await import("../src/work/api/nodes");
	saveWorkDevices("owner", [{ id: "saved", name: "已缓存设备", kind: "desktop", online: true, workProtocol: 1 }]);
	const cached = new QueryClient();
	cached.setQueryData(["facts"], { protocol: 1 });
	saveWorkQueries(cached, "owner", "saved");
	deviceState.error = new Error("网络失败");
	setActiveNode("local");
	const first = await render("/work/161323");
	expect(first.container.textContent).toContain("真实工作入口");
	expect(first.container.textContent).toContain("已缓存设备");
	const { deviceOnline } = await import("../src/work/lib/workOnline");
	expect(deviceOnline("saved")).toBe(false);
	await act(() => first.root.unmount());
	clearWorkCache();
	setActiveNode("local");
	const second = await render("/work/161323");
	expect(second.container.textContent).toContain("无法读取设备");
	expect(second.container.textContent).not.toContain("真实工作入口");
	await act(() => second.root.unmount());
});

it("设备授权被拒时清除账号缓存并停止显示旧设备", async () => {
	const data: Record<string, string> = {};
	vi.stubGlobal(
		"sessionStorage",
		new Proxy(
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
		),
	);
	const { saveWorkDevices, readWorkDevices, saveWorkQueries } = await import("../src/work/lib/offlineCache");
	saveWorkDevices("owner", [{ id: "saved", name: "旧设备", kind: "desktop", online: true, workProtocol: 1 }]);
	const cached = new QueryClient();
	cached.setQueryData(["facts"], { protocol: 1 });
	saveWorkQueries(cached, "owner", "saved");
	deviceState.error = Object.assign(new Error("forbidden"), { status: 403 });
	const { container, root } = await render("/work/161323");
	expect(container.textContent).toContain("设备访问权限已失效");
	expect(container.textContent).not.toContain("真实工作入口");
	expect(readWorkDevices("owner")).toBeUndefined();
	await act(() => root.unmount());
});

it("权威设备空列表覆盖旧缓存并清除解绑设备", async () => {
	const data: Record<string, string> = {};
	vi.stubGlobal(
		"sessionStorage",
		new Proxy(
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
		),
	);
	const { saveWorkDevices, readWorkDevices, saveWorkView, readWorkView } = await import("../src/work/lib/offlineCache");
	saveWorkDevices("owner", [{ id: "removed", name: "旧设备", kind: "desktop", online: true, workProtocol: 1 }]);
	saveWorkView("owner", "removed", "s1", { items: ["history"] });
	deviceState.devices = [];
	const { container, root } = await render();
	expect(container.textContent).toContain("连接设备后即可开始工作");
	expect(readWorkDevices("owner")).toEqual([]);
	expect(readWorkView("owner", "removed", "s1")).toBeNull();
	await act(() => root.unmount());
});
