import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContactList } from "../src/components/wallet/ContactList";
import { socialLoadError, socialUnavailable } from "../src/lib/socialError";

const api = vi.hoisted(() => ({ contacts: vi.fn(), devices: vi.fn(), conversations: vi.fn() }));
vi.mock("../src/api", () => ({ api }));
vi.mock("../src/pages/Connect", () => ({ AddDeviceDialog: () => null }));

describe("socialError", () => {
	it("treats gateway 404 and fetch failure as no social service", () => {
		expect(socialUnavailable(Object.assign(new Error("Not Found"), { status: 404 }))).toBe(true);
		expect(socialUnavailable(new TypeError("Failed to fetch"))).toBe(true);
		expect(socialUnavailable(Object.assign(new Error("boom"), { status: 500 }))).toBe(false);
		expect(socialLoadError(new TypeError("x"), "加载联系人失败")).toBe("当前节点没有提供社交服务");
		expect(socialLoadError(Object.assign(new Error("boom"), { status: 500 }), "加载联系人失败")).toBe(
			"加载联系人失败：boom",
		);
	});
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
	api.devices.mockResolvedValue([]);
	api.conversations.mockResolvedValue([]);
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
					<ContactList q="" tab="friends" meId="me" />
				</MemoryRouter>
			</QueryClientProvider>,
		),
	);
	await act(async () => {
		await new Promise((r) => setTimeout(r, 0));
	});
}

describe("ContactList 三种状态", () => {
	it("node without social service", async () => {
		api.contacts.mockRejectedValue(Object.assign(new Error("Not Found"), { status: 404 }));
		await render();
		expect(container.querySelector('[role="alert"]')?.textContent).toBe("当前节点没有提供社交服务");
		expect(container.textContent).toContain("重试");
	});

	it("other load failure keeps the reason", async () => {
		api.contacts.mockRejectedValue(Object.assign(new Error("server_error"), { status: 500 }));
		await render();
		expect(container.querySelector('[role="alert"]')?.textContent).toBe("加载联系人失败：server_error");
	});

	it("really empty shows the add-friend entry, no alert", async () => {
		api.contacts.mockResolvedValue([]);
		await render();
		expect(container.querySelector('[role="alert"]')).toBeNull();
		expect(container.textContent).toContain("添加朋友");
	});
});
