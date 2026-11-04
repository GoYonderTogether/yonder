import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BotDevices } from "../src/components/devices/BotDevices";

const api = vi.hoisted(() => ({ botDevices: vi.fn(), setBotDevices: vi.fn(), deviceGrants: vi.fn() }));
const toasts = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock("../src/api", () => ({ api }));
vi.mock("../src/ui/Toast", () => toasts);

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
					<BotDevices botId="bot" />
				</MemoryRouter>
			</QueryClientProvider>,
		),
	);
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 30));
	});
}

const devices = [
	{ id: "d1", name: "MacBook", kind: "laptop" as const, online: true },
	{ id: "d2", name: "家里的 Mac", kind: "desktop" as const, online: false },
];

describe("Bot 的可操作设备", () => {
	it("shows all devices by default and keeps grant truth per device", async () => {
		api.botDevices.mockResolvedValue({ botId: "bot", mode: "all", devices, allowed: ["d1", "d2"] });
		api.deviceGrants.mockImplementation((id: string) =>
			Promise.resolve(
				id === "d1"
					? {
							observed: true,
							grants: [
								{
									grantId: "g1",
									principalId: "p",
									botId: "bot",
									botLabel: "小未",
									source: "cloud",
									capabilities: ["read"],
									targetIds: [],
									readRoots: [],
									writeRoots: [],
									revision: 1,
									issuedAt: new Date().toISOString(),
									expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
									revokedAt: null,
								},
							],
						}
					: { observed: false, grants: [] },
			),
		);
		await render();
		const text = container.textContent ?? "";
		expect(text).toContain("全部设备");
		expect(text).toContain("MacBook");
		expect(text).toContain("可执行");
		expect(text).toContain("设备离线");
		expect(text).toContain("实际执行仍要设备上的授权");
	});

	it("narrows to a selection through the API and reports the real reason on refusal", async () => {
		api.botDevices.mockResolvedValue({ botId: "bot", mode: "all", devices, allowed: ["d1", "d2"] });
		api.deviceGrants.mockResolvedValue({ observed: true, grants: [] });
		api.setBotDevices.mockRejectedValue(Object.assign(new Error("not_found"), { status: 404 }));
		await render();
		const narrow = [...container.querySelectorAll("button")].find((b) => b.textContent === "收窄");
		await act(() => narrow!.dispatchEvent(new window.Event("click", { bubbles: true })));
		// Uncheck the second device, then save the narrowed selection.
		const box = container.querySelector('input[aria-label="允许 家里的 Mac · 台式机"]') as HTMLInputElement;
		// React 的 onChange 挂在 fiber props 上；linkedom 的 click 不产生受控 change，直接调用。
		const key = Object.keys(box).find((k) => k.startsWith("__reactProps$")) ?? "";
		const onChange = (box as unknown as Record<string, { onChange(e: unknown): void }>)[key].onChange;
		await act(() => onChange({ target: { checked: false } }));
		const save = [...container.querySelectorAll("button")].find((b) => b.textContent === "只允许选中的设备");
		await act(async () => {
			save!.dispatchEvent(new window.Event("click", { bubbles: true }));
			await new Promise((resolve) => setTimeout(resolve, 20));
		});
		expect(api.setBotDevices).toHaveBeenCalledWith("bot", { mode: "selected", devices: ["d1"] });
		expect(toasts.toast).toHaveBeenCalledWith("not_found", true);
	});

	it("distinguishes an unreported device from one with no grant", async () => {
		api.botDevices.mockResolvedValue({ botId: "bot", mode: "selected", devices, allowed: ["d1", "d2"] });
		api.deviceGrants.mockImplementation((id: string) =>
			Promise.resolve(id === "d1" ? { observed: true, grants: [] } : { observed: false, grants: [] }),
		);
		await render();
		const text = container.textContent ?? "";
		expect(text).toContain("无 grant");
		expect(text).toContain("设备离线");
		// d2 is offline, so its unreported state must not be reported as "no grant".
		expect(text.match(/无 grant/g)?.length).toBe(1);
	});

	it("names each device's kind so same-named devices stay distinguishable", async () => {
		// 两台同主机名的设备（本机 harness 与同一台电脑的执行端）除了名字只有类型不同；
		// 复选框的可访问名若不带类型，键盘与读屏用户无法知道自己在放开哪一台。
		const same = [
			{ id: "h1", name: "zorandeMacBook-Air.local", kind: "harness" as const, online: true },
			{ id: "e1", name: "zorandeMacBook-Air.local", kind: "laptop" as const, online: true },
		];
		api.botDevices.mockResolvedValue({ botId: "bot", mode: "selected", devices: same, allowed: ["h1"] });
		api.deviceGrants.mockResolvedValue({ observed: true, grants: [] });
		await render();
		const edit = [...container.querySelectorAll("button")].find((b) => b.textContent === "修改");
		if (!edit) throw new Error("missing 修改 button");
		await act(() => edit.dispatchEvent(new window.Event("click", { bubbles: true })));
		const labels = [...container.querySelectorAll("input[type=checkbox]")].map((box) => box.getAttribute("aria-label"));
		expect(labels).toEqual(["允许 zorandeMacBook-Air.local · 外部 harness", "允许 zorandeMacBook-Air.local · 笔记本"]);
	});

	it("says so when no device is bound", async () => {
		api.botDevices.mockResolvedValue({ botId: "bot", mode: "all", devices: [], allowed: [] });
		await render();
		expect(container.textContent).toContain("未绑定设备");
	});

	it("keeps excluded devices reachable in the edit view instead of hiding them (V3-web)", async () => {
		// 收窄后摘要只显示生效集合（research/04 流程 3）；进入修改时被排除的设备要能再次看到、重新勾上。
		api.botDevices.mockResolvedValue({ botId: "bot", mode: "selected", devices, allowed: ["d1"] });
		api.deviceGrants.mockResolvedValue({ observed: true, grants: [] });
		await render();
		const text = container.textContent ?? "";
		expect(text).toContain("已收窄到 1 台设备");
		expect(text).toContain("MacBook");
		// 摘要里没有未允许的设备，也没有给它们编造状态词。
		expect(text).not.toContain("家里的 Mac");
		const edit = [...container.querySelectorAll("button")].find((b) => b.textContent === "修改");
		if (!edit) throw new Error("missing 修改 button");
		await act(() => edit.dispatchEvent(new window.Event("click", { bubbles: true })));
		const edit_text = container.textContent ?? "";
		expect(edit_text).toContain("家里的 Mac");
		// 未允许的设备在编辑视图里就是未勾选的复选框，不显示「可执行」。
		const excluded = container.querySelector('input[aria-label="允许 家里的 Mac · 台式机"]') as HTMLInputElement;
		expect(excluded.checked).toBe(false);
		expect(edit_text).not.toContain("可执行");
	});
});
