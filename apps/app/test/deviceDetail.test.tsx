import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeviceDetail } from "../src/components/devices/DeviceDetail";

const api = vi.hoisted(() => ({ contacts: vi.fn(), deviceGrants: vi.fn(), revokeDeviceGrant: vi.fn() }));
const toasts = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock("../src/api", () => ({ api }));
vi.mock("../src/ui/Toast", () => toasts);
vi.mock("../src/work/api/work", () => ({ deviceSessions: async () => [] }));

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

async function render(device: Parameters<typeof DeviceDetail>[0]["device"]) {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	await act(async () =>
		root.render(
			<QueryClientProvider client={client}>
				<MemoryRouter>
					<DeviceDetail device={device} accountId="me" workBase="/work/device" />
				</MemoryRouter>
			</QueryClientProvider>,
		),
	);
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 30));
	});
}

const grant = {
	grantId: "g1",
	principalId: "p".repeat(64),
	botId: "bot",
	botLabel: "小未",
	source: "cloud" as const,
	capabilities: ["read", "write"],
	targetIds: ["host:filesystem"],
	readRoots: ["/home/me"],
	writeRoots: [],
	revision: 2,
	issuedAt: new Date().toISOString(),
	expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
	revokedAt: null,
};

describe("设备详情", () => {
	it("shows the device's bots, executor identity and grants", async () => {
		api.contacts.mockResolvedValue([{ id: "bot", kind: "agent", name: "小未", ownerId: "me", deviceId: "d1" }]);
		api.deviceGrants.mockResolvedValue({ observed: true, grants: [grant] });
		await render({
			id: "d1",
			name: "MacBook",
			kind: "laptop",
			online: true,
			workProtocol: 1,
			executor: { deviceId: "00000000-0000-4000-8000-000000000001", publicKey: "pk" },
		});
		const text = container.textContent ?? "";
		expect(text).toContain("执行端已登记");
		expect(text).toContain("00000000-0000-4000-8000-000000000001");
		expect(text).toContain("小未");
		expect(text).toContain("生效中");
		expect(text).toContain("read · write");
		expect(text).toContain("第 2 版");
	});

	it("never shows an unreported device as having no grants", async () => {
		api.contacts.mockResolvedValue([]);
		api.deviceGrants.mockResolvedValue({ observed: false, grants: [] });
		await render({ id: "d1", name: "MacBook", kind: "laptop", online: false });
		const text = container.textContent ?? "";
		expect(text).toContain("还没有上报过授权");
		expect(text).not.toContain("没有发给任何 Bot 的授权");
	});

	it("marks a harness connector as not participating in device execution", async () => {
		api.contacts.mockResolvedValue([]);
		api.deviceGrants.mockResolvedValue({ observed: true, grants: [] });
		await render({ id: "d1", name: "DSH", kind: "harness", online: true, workProtocol: 1 });
		expect(container.textContent).toContain("不提供设备执行");
		expect(container.textContent).not.toContain("执行端未登记");
	});

	it("says an offline revocation is queued, not applied", async () => {
		api.contacts.mockResolvedValue([]);
		api.deviceGrants.mockResolvedValue({ observed: true, grants: [grant] });
		api.revokeDeviceGrant.mockResolvedValue({ revoked: true, pending: true });
		await render({ id: "d1", name: "MacBook", kind: "laptop", online: false });
		const button = [...container.querySelectorAll("button")].find((item) => item.textContent === "撤销");
		await act(async () => {
			button!.dispatchEvent(new window.Event("click", { bubbles: true }));
			await new Promise((resolve) => setTimeout(resolve, 20));
		});
		expect(api.revokeDeviceGrant).toHaveBeenCalledWith("d1", "g1");
		expect(toasts.toast).toHaveBeenCalledWith("设备离线，撤销已排队，重连后生效");
	});
});
