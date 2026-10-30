import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { $session } from "../src/store";
import { WorkApp } from "../src/work/WorkApp";

const deviceState = vi.hoisted(() => ({
	devices: [] as Array<{ id: string; name: string; kind: "desktop"; online: boolean; workProtocol?: 1 }>,
}));
vi.mock("../src/api", () => ({ api: { devices: () => Promise.resolve(deviceState.devices) } }));
vi.mock("../src/work/lib/queries", () => ({ useFacts: () => ({ data: { protocol: 1 } }) }));
vi.mock("../src/work/WorkShell", () => ({ WorkShell: () => <div>真实工作入口</div> }));
vi.mock("../src/components/PersonalDrawer", () => ({ PersonalAvatar: () => null }));
afterEach(() => {
	$session.set(undefined);
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
});

async function render() {
	vi.stubEnv("VITE_API", "http");
	const { document, window } = parseHTML("<html><body></body></html>");
	vi.stubGlobal("window", window);
	vi.stubGlobal("document", document);
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	$session.set({ actor: { id: "owner", kind: "human", name: "Owner" } });
	const container = document.createElement("div") as unknown as HTMLElement;
	const root = createRoot(container);
	await act(async () =>
		root.render(
			<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
				<MemoryRouter initialEntries={["/work"]}>
					<WorkApp />
				</MemoryRouter>
			</QueryClientProvider>,
		),
	);
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 30));
	});
	return { container, root };
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
