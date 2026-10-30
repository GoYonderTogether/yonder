import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentPublicToggle } from "../src/components/AgentPublicToggle";
import { Me } from "../src/pages/Me";
import { $session } from "../src/store";

const api = vi.hoisted(() => ({ contacts: vi.fn(), setAgentPublic: vi.fn() }));
vi.mock("../src/api", () => ({ api }));
vi.mock("../src/components/wallet/ContactDetail", () => ({ SelfIdentity: () => null }));
vi.mock("../src/components/AccountSecurity", () => ({ AccountSecurity: () => null }));
vi.mock("../src/ui/Toast", () => ({ toast: vi.fn() }));

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
	$session.set(undefined);
	vi.unstubAllGlobals();
	vi.resetAllMocks();
});

async function render(node: React.ReactNode) {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	await act(async () =>
		root.render(
			<QueryClientProvider client={client}>
				<MemoryRouter>{node}</MemoryRouter>
			</QueryClientProvider>,
		),
	);
	await act(async () => {
		await new Promise((r) => setTimeout(r, 0));
	});
}

const human = { id: "me", kind: "human" as const, name: "Me" };

describe("Me 页按登录态", () => {
	it("显示渠道状态来源与接入指引", async () => {
		$session.set({ actor: human });
		api.contacts.mockResolvedValue([]);
		await render(<Me />);
		for (const text of [
			"渠道接入",
			"飞书：状态未知",
			"微信：状态未知",
			"QQ：状态未知",
			"yonder channels list",
			"yonder channels login feishu",
			"yonder channels login wechat-ilink",
			"yonder-qq setup",
		]) {
			expect(container.textContent).toContain(text);
		}
	});
	it("anonymous visitor gets the register guide and login button, no contact load", async () => {
		$session.set({ actor: { ...human, anonymous: true } });
		await render(<Me />);
		expect(container.textContent).toContain("注册后可加好友");
		expect(container.textContent).toContain("注册 / 登录");
		expect(api.contacts).not.toHaveBeenCalled();
	});

	it("signed-in user with failed contacts sees the error and retry, not the empty hint", async () => {
		$session.set({ actor: human });
		api.contacts.mockRejectedValue(Object.assign(new Error("boom"), { status: 500 }));
		await render(<Me />);
		expect(container.querySelector('[role="alert"]')?.textContent).toBe("加载 Bot 失败：boom");
		expect(container.textContent).not.toContain("连接设备后");
	});

	it("signed-in user with no agents sees the empty hint", async () => {
		$session.set({ actor: human });
		api.contacts.mockResolvedValue([]);
		await render(<Me />);
		expect(container.querySelector('[role="alert"]')).toBeNull();
		expect(container.textContent).toContain("连接设备后，Bot 会出现在这里");
	});
});

describe("AgentPublicToggle", () => {
	it("shows inline error when saving fails", async () => {
		api.setAgentPublic.mockRejectedValue(new Error("forbidden"));
		await render(<AgentPublicToggle actor={{ id: "a1", kind: "agent", name: "A" }} />);
		const input = container.querySelector("input") as HTMLInputElement;
		const key = Object.keys(input).find((k) => k.startsWith("__reactProps$")) ?? "";
		const props = (input as unknown as Record<string, { onChange(e: unknown): Promise<void> }>)[key];
		await act(async () => props.onChange({ target: { checked: true } }));
		expect(container.querySelector('[role="alert"]')?.textContent).toBe("forbidden");
		expect(input.disabled).toBe(false);
	});
});
