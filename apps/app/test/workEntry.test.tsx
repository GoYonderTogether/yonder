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
}));
vi.mock("../src/api", () => ({ api: { devices: () => Promise.resolve(deviceState.devices) } }));
vi.mock("../src/work/lib/queries", () => ({
	useFacts: () => ({ data: { protocol: 1 } }),
	deviceAgentMap: () => new Map(),
	fetchDeviceAgents: async () => [],
}));
vi.mock("../src/work/WorkShell", () => ({ WorkShell: () => <div>真实工作入口</div> }));
vi.mock("../src/components/PersonalDrawer", () => ({ PersonalAvatar: () => null }));
afterEach(() => {
	$session.set(undefined);
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
	const select = container.querySelector("select") as HTMLSelectElement;
	const key = Object.keys(select).find((k) => k.startsWith("__reactProps$")) ?? "";
	await act(async () =>
		(select as unknown as Record<string, { onChange(event: unknown): void }>)[key]?.onChange({
			target: { value: "second" },
		}),
	);
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
	const select = container.querySelector("select") as HTMLSelectElement;
	const key = Object.keys(select).find((name) => name.startsWith("__reactProps$")) ?? "";
	await act(async () =>
		(select as unknown as Record<string, { onChange(event: unknown): void }>)[key]?.onChange({
			target: { value: "first" },
		}),
	);
	expect(container.querySelector("output")?.textContent).toBe("/work/device/first/161097");
	await act(() => root.unmount());
});
