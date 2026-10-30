import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContactList } from "../src/components/wallet/ContactList";
import { $session } from "../src/store";

const api = vi.hoisted(() => ({ contacts: vi.fn(), openDm: vi.fn() }));
vi.mock("../src/api", () => ({ api }));

let container: HTMLElement;
let root: Root;
let pathname = "/";

function Probe() {
	pathname = useLocation().pathname;
	return null;
}

beforeEach(() => {
	const { document, window } = parseHTML("<html><body></body></html>");
	vi.stubGlobal("window", window);
	vi.stubGlobal("document", document);
	vi.stubGlobal("location", { href: "http://localhost:5180/contacts", origin: "http://localhost:5180" });
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
	container = document.createElement("div") as unknown as HTMLElement;
	document.body.appendChild(container as never);
	root = createRoot(container);
	pathname = "/contacts";
	$session.set({ actor: { id: "me", kind: "human", name: "我" } });
});

afterEach(async () => {
	await act(() => root.unmount());
	$session.set(undefined);
	vi.unstubAllGlobals();
	vi.resetAllMocks();
});

async function render() {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	await act(async () =>
		root.render(
			<QueryClientProvider client={client}>
				<MemoryRouter initialEntries={["/contacts"]}>
					<ContactList q="" />
					<Probe />
				</MemoryRouter>
			</QueryClientProvider>,
		),
	);
	await act(async () => {
		await new Promise((r) => setTimeout(r, 20));
	});
}

describe("通讯录的「我的 Bot」", () => {
	it("在好友列表下方列出自己的 Bot，不列别人的 Bot", async () => {
		api.contacts.mockResolvedValue([
			{ id: "friend1", kind: "human", name: "阿明" },
			{ id: "bot1", kind: "agent", name: "小歪", ownerId: "me" },
			{ id: "bot2", kind: "agent", name: "别人的 Bot", ownerId: "someone" },
		]);
		await render();
		const section = container.querySelector('[data-testid="my-bots"]');
		expect(section?.textContent).toContain("我的 Bot");
		expect(section?.textContent).toContain("小歪");
		expect(section?.textContent).not.toContain("别人的 Bot");
		// 好友在前，我的 Bot 在后。
		const text = container.textContent ?? "";
		expect(text.indexOf("阿明")).toBeLessThan(text.indexOf("我的 Bot"));
	});

	it("「发消息」直接开与这个 Bot 的私聊", async () => {
		api.contacts.mockResolvedValue([{ id: "bot1", kind: "agent", name: "小歪", ownerId: "me" }]);
		api.openDm.mockResolvedValue({ id: "conv1", code: "ABC123", kind: "dm", title: "小歪", memberIds: ["me", "bot1"] });
		await render();
		const send = [...container.querySelectorAll("button")].find((b) => b.textContent?.includes("发消息"));
		expect(send).toBeTruthy();
		await act(async () => send?.click());
		await act(async () => {
			await new Promise((r) => setTimeout(r, 20));
		});
		expect(api.openDm).toHaveBeenCalledWith("bot1");
		expect(pathname).toBe("/c/ABC123");
	});

	it("没有自己的 Bot 时不显示这一段", async () => {
		api.contacts.mockResolvedValue([{ id: "friend1", kind: "human", name: "阿明" }]);
		await render();
		expect(container.querySelector('[data-testid="my-bots"]')).toBeNull();
	});
});
