import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { WorkApp } from "../src/work/WorkApp";

afterEach(() => {
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
});

it("云端工作入口提供授权和安装入口，不探测社交源站的网关", async () => {
	vi.stubEnv("VITE_API", "http");
	const { document, window } = parseHTML("<html><body></body></html>");
	vi.stubGlobal("window", window);
	vi.stubGlobal("document", document);
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	const fetch = vi.fn();
	vi.stubGlobal("fetch", fetch);
	const container = document.createElement("div") as unknown as HTMLElement;
	const root = createRoot(container);
	await act(async () =>
		root.render(
			<QueryClientProvider client={new QueryClient()}>
				<MemoryRouter>
					<WorkApp />
				</MemoryRouter>
			</QueryClientProvider>,
		),
	);
	const html = container.innerHTML;
	expect(html).toContain("连接设备，开始工作");
	expect(html).toContain('href="/console/"');
	expect(html).toContain('href="/get"');
	expect(html).toContain("消息设备连接不会自动授予工作台访问权限");
	expect(fetch).not.toHaveBeenCalled();
	await act(() => root.unmount());
});

it("切换设备时清除旧查询数据", async () => {
	vi.stubEnv("VITE_API", "http");
	const { document, window } = parseHTML("<html><body></body></html>");
	vi.stubGlobal("window", window);
	vi.stubGlobal("document", document);
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	vi.stubGlobal(
		"fetch",
		vi.fn(async () => ({
			status: 200,
			ok: true,
			json: async () => ({ ok: true, result: { protocol: 1, node: { id: "switch-test", name: "test" } } }),
		})),
	);
	const { addNode, setActiveNode } = await import("../src/work/api/nodes");
	const node = await addNode({ origin: "https://example.test" });
	const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	const container = document.createElement("div") as unknown as HTMLElement;
	const root = createRoot(container);
	await act(async () =>
		root.render(
			<QueryClientProvider client={qc}>
				<MemoryRouter>
					<WorkApp />
				</MemoryRouter>
			</QueryClientProvider>,
		),
	);
	qc.setQueryData(["sessions", "work"], ["old-node-data"]);
	await act(async () => setActiveNode(node.id));
	expect(qc.getQueryData(["sessions", "work"])).toBeUndefined();
	await act(() => root.unmount());
	await new Promise((resolve) => setTimeout(resolve, 20));
});
