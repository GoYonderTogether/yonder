import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConnectApps } from "../src/pages/ConnectApps";

const api = vi.hoisted(() => ({ devices: vi.fn() }));
vi.mock("../src/api", () => ({ api }));

const shell = vi.hoisted(() => ({ hasNativeShell: vi.fn() }));
vi.mock("../src/lib/nativePermissions", () => ({
	hasNativeShell: shell.hasNativeShell,
	nativePermissionStatus: vi.fn(),
	requestNativePermission: vi.fn(),
}));

// 页面按账号读设备列表；测试里固定一个已登录账号（atom 在 factory 里建，避免 hoisting 问题）。
vi.mock("../src/store", async () => {
	const { atom } = await import("nanostores");
	return { $session: atom({ actor: { id: "me", kind: "human" } }) };
});

let container: HTMLElement;
let root: Root;

beforeEach(() => {
	const { document, window } = parseHTML("<html><body></body></html>");
	vi.stubGlobal("window", window);
	vi.stubGlobal("document", document);
	vi.stubGlobal("sessionStorage", { getItem: () => null, setItem: () => undefined, removeItem: () => undefined });
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	shell.hasNativeShell.mockReturnValue(false);
	api.devices.mockResolvedValue([]);
	container = document.createElement("div") as unknown as HTMLElement;
	document.body.appendChild(container as unknown as HTMLElement);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root.unmount());
	vi.unstubAllGlobals();
	vi.resetAllMocks();
});

async function render() {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	await act(async () =>
		root.render(
			<QueryClientProvider client={client}>
				<MemoryRouter initialEntries={["/me/connect-apps"]}>
					<ConnectApps />
				</MemoryRouter>
			</QueryClientProvider>,
		),
	);
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 20));
	});
	return client;
}

describe("连接应用页", () => {
	it("iOS 段在壳外如实说明需要 iPhone 应用，不渲染假按钮", async () => {
		shell.hasNativeShell.mockReturnValue(false);
		await render();
		expect(document.body.textContent).toContain("这段需要 iPhone 上的 Yonder 应用打开");
		expect(document.querySelector('button[aria-label="授权日历"]')).toBeNull();
	});

	it("iOS 段在壳里渲染六项能力，每项一个 + 按钮", async () => {
		shell.hasNativeShell.mockReturnValue(true);
		await render();
		for (const label of ["日历", "提醒事项", "通讯录", "照片", "位置", "健康"]) {
			expect(document.querySelector(`button[aria-label="授权${label}"]`)).not.toBeNull();
		}
	});

	it("Mac/Windows/Linux 段没有配对设备时给下载链接，不显示 iOS 能力行", async () => {
		await render();
		for (const label of ["Mac", "Windows", "Linux"]) {
			const tab = [...document.querySelectorAll('[role="tab"]')].find((el) => el.textContent === label);
			expect(tab, `${label} 段缺失`).toBeTruthy();
			await act(async () => (tab as HTMLElement).dispatchEvent(new window.Event("click", { bubbles: true })));
		}
		expect(document.body.textContent).toContain("还没有配对的 Linux 设备");
		expect(document.querySelector("a[href='/get']")).not.toBeNull();
	});

	it("Mac 段列出已配对的笔记本/台式机设备并链接到设备详情", async () => {
		api.devices.mockResolvedValue([
			{ id: "d1", name: "MacBook Pro", kind: "laptop", online: true },
			{ id: "d2", name: "云服务器", kind: "cloud", online: true },
		]);
		await render();
		const tab = [...document.querySelectorAll('[role="tab"]')].find((el) => el.textContent === "Mac");
		expect(tab, "Mac 段缺失").toBeTruthy();
		await act(async () => (tab as HTMLElement).dispatchEvent(new window.Event("click", { bubbles: true })));
		expect(document.body.textContent).toContain("MacBook Pro");
		expect(document.body.textContent).not.toContain("云服务器");
		expect(document.querySelector("a[href='/me/devices/d1']")).not.toBeNull();
	});
});
