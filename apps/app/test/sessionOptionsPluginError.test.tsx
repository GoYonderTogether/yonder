import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SessionOptions } from "../src/work/ui/SessionOptions";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("../src/work/api/client", () => ({ rpc }));
// Menu 的展开态由 radix Popover 控制；替换后内容常显，断言不依赖交互。
vi.mock("radix-ui", async () => {
	const { createElement: h, Fragment } = await import("react");
	const box = (tag: string) => (p: { children?: React.ReactNode }) => h(tag, null, p.children);
	return {
		Popover: {
			Root: (p: { children?: React.ReactNode }) => h(Fragment, null, p.children),
			Trigger: (p: { children?: React.ReactNode }) => h("button", null, p.children),
			Portal: box("div"),
			Content: box("div"),
		},
	};
});

let container: HTMLElement;
let root: Root;

beforeEach(() => {
	const { document, window } = parseHTML("<html><body></body></html>");
	vi.stubGlobal("window", window);
	vi.stubGlobal("document", document);
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	container = document.createElement("div") as unknown as HTMLElement;
	document.body.appendChild(container as never);
	root = createRoot(container);
});

afterEach(async () => {
	await act(() => root.unmount());
	vi.unstubAllGlobals();
	vi.resetAllMocks();
});

async function render() {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	await act(async () =>
		root.render(
			<QueryClientProvider client={client}>
				<MemoryRouter>
					<SessionOptions node={{ id: "local" }} value={{}} onChange={() => {}} runtime={null} />
				</MemoryRouter>
			</QueryClientProvider>,
		),
	);
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 20));
	});
}

describe("工作区选择器的真实错误", () => {
	it("shows the host's real reason when the devices plugin is missing, instead of an empty device list", async () => {
		// 宿主在 devices 插件缺失时对 workspaces.list 返回这句话（P2 9552a057）；
		// 页面必须原样给出，不能把它渲染成「没有可操控设备」。
		rpc.mockImplementation((method: string) =>
			method === "workspaces.list"
				? Promise.reject(
						new Error(
							"Remote resources need the devices plugin; add it with `yonder plugins add @yonder/plugin-devices`",
						),
					)
				: Promise.reject(new Error("unused in this test")),
		);
		await render();
		const text = container.textContent ?? "";
		expect(text).toContain("Remote resources need the devices plugin");
		// 不是把失败渲染成「没有设备」的空态提示。
		expect(text).not.toContain("未指定工作区可操控");
	});

	it("keeps showing the real devices once the read succeeds", async () => {
		rpc.mockImplementation((method: string) => {
			if (method !== "workspaces.list") return Promise.reject(new Error("unused in this test"));
			return Promise.resolve({
				devices: [{ deviceId: "d1", name: "MacBook", status: "ready", targets: [], paths: [] }],
			});
		});
		await render();
		const text = container.textContent ?? "";
		expect(text).toContain("MacBook");
		expect(text).toContain("在线");
		expect(text).not.toContain("devices plugin");
	});
});
