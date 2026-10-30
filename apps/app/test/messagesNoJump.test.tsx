import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatShell } from "../src/pages/Chat";
import { $session } from "../src/store";

const api = vi.hoisted(() => ({
	conversations: vi.fn(),
	actors: vi.fn(),
	contacts: vi.fn(),
	subscribe: vi.fn(() => () => {}),
	openDm: vi.fn(),
	ensureDefaultBot: vi.fn(),
}));
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
	vi.stubGlobal("location", { href: "http://localhost:5180/", origin: "http://localhost:5180" });
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
	container = document.createElement("div") as unknown as HTMLElement;
	document.body.appendChild(container as never);
	root = createRoot(container);
	pathname = "/";
	$session.set({ actor: { id: "me", kind: "human", name: "我" } });
	api.actors.mockResolvedValue([]);
	api.subscribe.mockReturnValue(() => {});
	api.contacts.mockResolvedValue([{ id: "bot1", kind: "agent", name: "小歪", ownerId: "me" }]);
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
				<MemoryRouter initialEntries={["/"]}>
					<ChatShell />
					<Probe />
				</MemoryRouter>
			</QueryClientProvider>,
		),
	);
	await act(async () => {
		await new Promise((r) => setTimeout(r, 20));
	});
}

const button = (text: string) => [...container.querySelectorAll("button")].find((b) => b.textContent?.includes(text));

describe("消息页不自动跳转", () => {
	it("有默认 Bot 但没有会话时留在列表，只显示空态", async () => {
		api.conversations.mockResolvedValue([]);
		await render();
		expect(pathname).toBe("/");
		expect(api.openDm).not.toHaveBeenCalled();
		expect(container.textContent).toContain("还没有会话");
		expect(button("开始聊天")).toBeTruthy();
	});

	it("有会话时也不自动进入第一个会话", async () => {
		api.conversations.mockResolvedValue([
			{ id: "conv1", code: "ABC123", kind: "dm", title: "小歪", memberIds: ["me", "bot1"], unread: 0 },
		]);
		await render();
		expect(pathname).toBe("/");
		expect(container.textContent).toContain("小歪");
		expect(container.textContent).toContain("选一个会话开始聊天");
		expect(container.textContent).not.toContain("还没有会话");
		expect(button("开始聊天")).toBeFalsy();
	});

	it("点「开始聊天」才开私聊并进入会话", async () => {
		api.conversations.mockResolvedValue([]);
		api.openDm.mockResolvedValue({ id: "conv1", code: "ABC123", kind: "dm", title: "小歪", memberIds: ["me", "bot1"] });
		await render();
		const start = button("开始聊天");
		expect(start).toBeTruthy();
		await act(async () => start?.click());
		await act(async () => {
			await new Promise((r) => setTimeout(r, 20));
		});
		expect(api.openDm).toHaveBeenCalledWith("bot1");
		expect(pathname).toBe("/c/ABC123");
	});
});
