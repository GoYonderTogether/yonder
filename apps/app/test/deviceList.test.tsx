import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeviceList } from "../src/components/devices/DeviceList";

const api = vi.hoisted(() => ({ devices: vi.fn(), contacts: vi.fn() }));
vi.mock("../src/api", () => ({ api }));

let container: HTMLElement;
let root: Root;

beforeEach(() => {
	const { document, window } = parseHTML("<html><body></body></html>");
	vi.stubGlobal("window", window);
	vi.stubGlobal("document", document);
	vi.stubGlobal("sessionStorage", { getItem: () => null, setItem: () => undefined, removeItem: () => undefined });
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
				<MemoryRouter initialEntries={["/me/devices"]}>
					<DeviceList accountId="me" base="/me/devices" />
				</MemoryRouter>
			</QueryClientProvider>,
		),
	);
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 20));
	});
}

describe("设备列表", () => {
	it("shows every bound device with its real state word, kind and bot count", async () => {
		api.devices.mockResolvedValue([
			{
				id: "d1",
				name: "MacBook",
				kind: "laptop",
				online: true,
				workProtocol: 1,
				lastSeenAt: new Date().toISOString(),
			},
			{ id: "d2", name: "云主机", kind: "cloud", online: true },
			{ id: "d3", name: "家里的 Mac", kind: "desktop", online: false },
			{ id: "d4", name: "DSH", kind: "harness", online: true, workProtocol: 1 },
		]);
		api.contacts.mockResolvedValue([{ id: "b1", kind: "agent", name: "小未", ownerId: "me", deviceId: "d1" }]);
		await render();
		const text = container.textContent ?? "";
		expect(text).toContain("MacBook");
		expect(text).toContain("在线");
		expect(text).toContain("需要更新 Yonder");
		expect(text).toContain("离线");
		expect(text).toContain("1 个 Bot");
		expect(text).toContain("笔记本");
		expect(text).toContain("云端运行时");
		// A harness connector is listed as a device and is not called "executor missing": it has none by definition.
		expect(text).toContain("外部 harness");
		const harness = container.querySelector('a[href="/me/devices/d4"]')?.textContent ?? "";
		expect(harness).toContain("在线");
		expect(harness).not.toContain("执行端");
		// An online device that never reported an executor says so.
		const laptop = container.querySelector('a[href="/me/devices/d1"]')?.textContent ?? "";
		expect(laptop).toContain("执行端未登记");
		expect(container.querySelectorAll("a").length).toBe(4);
		expect(container.querySelector('a[href="/me/devices/d4"]')).not.toBeNull();
	});

	it("says the device list is empty instead of pretending it failed", async () => {
		api.devices.mockResolvedValue([]);
		api.contacts.mockResolvedValue([]);
		await render();
		expect(container.textContent).toContain("还没有绑定设备");
		expect(container.textContent).not.toContain("无法读取设备");
	});

	it("separates a failed read from an empty list", async () => {
		api.devices.mockRejectedValue(new Error("boom"));
		api.contacts.mockResolvedValue([]);
		await render();
		expect(container.textContent).toContain("无法读取设备");
		expect(container.textContent).not.toContain("还没有绑定设备");
	});

	it("names an expired session as forbidden", async () => {
		api.devices.mockRejectedValue(Object.assign(new Error("unauthorized"), { status: 403 }));
		api.contacts.mockResolvedValue([]);
		await render();
		expect(container.textContent).toContain("设备访问权限已失效");
	});
});
