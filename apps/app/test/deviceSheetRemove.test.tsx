import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DeviceSheet } from "../src/components/wallet/DeviceSheet";

const api = vi.hoisted(() => ({ removeDevice: vi.fn(), renameDevice: vi.fn() }));
const toasts = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock("../src/api", () => ({ api }));
vi.mock("../src/ui/Toast", () => toasts);
// Dialog 用 radix 真实现会挂 portal；这里只渲染内容本体，交互断言不受 portal 影响。
vi.mock("radix-ui", async () => {
	const { createElement: h, Fragment } = await import("react");
	const box = (tag: string) => (p: { children?: React.ReactNode }) => h(tag, null, p.children);
	return {
		Dialog: {
			Root: (p: { open: boolean; children?: React.ReactNode }) => (p.open ? h(Fragment, null, p.children) : null),
			Portal: box("div"),
			Overlay: () => null,
			Content: box("section"),
			Title: box("h2"),
			Description: box("p"),
			Close: (p: { children?: React.ReactNode }) => h(Fragment, null, p.children),
		},
	};
});

let container: HTMLElement;
let root: Root;
let window: Window;

beforeEach(() => {
	const parsed = parseHTML("<html><body></body></html>");
	window = parsed.window;
	vi.stubGlobal("window", window);
	vi.stubGlobal("document", parsed.document);
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	container = parsed.document.createElement("div") as unknown as HTMLElement;
	parsed.document.body.appendChild(container as never);
	root = createRoot(container);
});

afterEach(async () => {
	await act(() => root.unmount());
	vi.unstubAllGlobals();
	vi.resetAllMocks();
});

const device = { id: "d1", name: "MacBook", kind: "laptop" as const, online: true };

async function render(props: Partial<Parameters<typeof DeviceSheet>[0]> = {}) {
	await act(() =>
		root.render(<DeviceSheet device={device} agents={2} open onOpenChange={() => {}} onChanged={vi.fn()} {...props} />),
	);
}

const click = async (label: string) => {
	const button = [...container.querySelectorAll("button")].find((item) => item.textContent === label);
	if (!button) throw new Error(`missing button ${label}`);
	await act(async () => {
		button.dispatchEvent(new window.Event("click", { bubbles: true }));
		await new Promise((resolve) => setTimeout(resolve, 20));
	});
};

describe("设备管理弹层的解绑回调", () => {
	it("解绑成功后只调 onRemoved，不把普通 onChanged 当回列表用", async () => {
		const onChanged = vi.fn();
		const onRemoved = vi.fn();
		api.removeDevice.mockResolvedValue(undefined);
		await render({ onChanged, onRemoved });
		await click("解绑设备");
		await click("确认解绑");
		expect(api.removeDevice).toHaveBeenCalledWith("d1");
		expect(onRemoved).toHaveBeenCalledTimes(1);
		expect(onChanged).not.toHaveBeenCalled();
		expect(toasts.toast).toHaveBeenCalledWith("设备已解绑");
	});

	it("没有单独传 onRemoved 时退回 onChanged，旧调用方行为不变", async () => {
		const onChanged = vi.fn();
		api.removeDevice.mockResolvedValue(undefined);
		await render({ onChanged });
		await click("解绑设备");
		await click("确认解绑");
		expect(onChanged).toHaveBeenCalledTimes(1);
	});

	it("解绑失败时两个回调都不触发，真实原因进 toast", async () => {
		const onChanged = vi.fn();
		const onRemoved = vi.fn();
		api.removeDevice.mockRejectedValue(new Error("设备仍在线，请先断开"));
		await render({ onChanged, onRemoved });
		await click("解绑设备");
		await click("确认解绑");
		expect(onRemoved).not.toHaveBeenCalled();
		expect(onChanged).not.toHaveBeenCalled();
		expect(toasts.toast).toHaveBeenCalledWith("设备仍在线，请先断开", true);
	});
});
