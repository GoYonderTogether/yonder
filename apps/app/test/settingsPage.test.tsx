import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, expect, it, vi } from "vitest";
import { SettingsPage } from "../src/pages/SettingsPage";
import { $session } from "../src/store";

vi.mock("../src/api", () => ({
	api: { devices: () => Promise.resolve([{ id: "offline", name: "离线设备", online: false }]) },
}));
vi.mock("../src/pages/Me", () => ({ ProfileDialog: () => null }));
vi.mock("../src/work/features/settings/NotifySection", () => ({
	NotifySection: ({ deviceAvailable }: { deviceAvailable: boolean }) => (
		<p>浏览器通知 · {deviceAvailable ? "设备可用" : "设备不可用"}</p>
	),
}));
vi.mock("../src/work/features/settings/NodesSection", () => ({ NodesSection: () => <p>网关令牌</p> }));
vi.mock("../src/work/features/settings/ChannelsSection", () => ({ ChannelsSection: () => <p>设备渠道</p> }));
vi.mock("../src/work/features/settings/SocialSection", () => ({ SocialSection: () => <p>设备社交</p> }));
vi.mock("../src/work/features/settings/AboutSection", () => ({ AboutSection: () => <p>本机更新</p> }));

afterEach(() => {
	$session.set(undefined);
	vi.unstubAllGlobals();
});

it("离线云设备仍可进入本地通知，不暴露网关令牌或误启设备设置", async () => {
	const { document, window } = parseHTML("<html><body></body></html>");
	vi.stubGlobal("window", window);
	vi.stubGlobal("document", document);
	vi.stubGlobal("HTMLElement", window.HTMLElement);
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	$session.set({ actor: { id: "owner", kind: "human", name: "主人" } });
	const host = document.createElement("div");
	document.body.appendChild(host);
	const root = createRoot(host as never);
	await act(async () => {
		root.render(
			<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
				<MemoryRouter initialEntries={["/me/settings/notifications"]}>
					<Routes>
						<Route path="/me/settings/:section?" element={<SettingsPage />} />
					</Routes>
				</MemoryRouter>
			</QueryClientProvider>,
		);
	});
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 20));
	});
	expect(host.textContent).toContain("浏览器通知 · 设备不可用");
	expect(host.textContent).toContain("离线设备");
	expect(host.textContent).not.toContain("网关令牌");
	expect(host.querySelector('a[aria-label="返回"]')?.getAttribute("href")).toBe("/me/settings");
	await act(() => root.unmount());
});
