import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deviceOnline, setWorkDevices } from "../src/work/lib/workOnline";

const api = vi.hoisted(() => ({ devices: vi.fn(), deviceGrants: vi.fn(), contacts: vi.fn() }));
vi.mock("../src/api", () => ({ api }));
vi.mock("../src/ui/Toast", () => ({ toast: vi.fn() }));
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
	setWorkDevices([]);
});

/**
 * 设备页开着时，工作桥的在线判断必须拿到这批真实设备；否则设备详情里的会话列表走远程 rpc，
 * 会在 `deviceOnline` 守卫处一律报「设备暂未连接」，即使设备此刻在线且 workProtocol=1。
 */
describe("设备页把在线事实交给工作桥", () => {
	it("fills the work-bridge online map from the device list query", async () => {
		const { useAccountDevices } = await import("../src/components/devices/queries");
		api.devices.mockResolvedValue([
			{
				id: "d1",
				name: "MacBook",
				kind: "laptop",
				online: true,
				workProtocol: 1,
				lastSeenAt: new Date().toISOString(),
			},
		]);
		function Probe() {
			useAccountDevices("me");
			return null;
		}
		const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
		await act(async () =>
			root.render(
				<QueryClientProvider client={client}>
					<MemoryRouter>
						<Probe />
					</MemoryRouter>
				</QueryClientProvider>,
			),
		);
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 30));
		});
		expect(api.devices).toHaveBeenCalled();
		expect(deviceOnline("d1")).toBe(true);
	});
});
