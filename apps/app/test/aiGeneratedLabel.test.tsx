import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Actor, Conversation } from "../src/api/types";
import { $session } from "../src/store";

const api = vi.hoisted(() => ({
	conversations: vi.fn(),
	messages: vi.fn(),
	actors: vi.fn(),
	conversationDetail: vi.fn(),
	contacts: vi.fn(),
	subscribe: vi.fn(() => () => {}),
	markRead: vi.fn(async () => {}),
}));
vi.mock("../src/api", () => ({ api }));
vi.mock("../src/ui/Toast", () => ({ toast: vi.fn() }));
const { Conversation: ConversationPage } = await import("../src/pages/Chat");

const me: Actor = { id: "me", kind: "human", name: "我" };
const bot: Actor = { id: "bot1", kind: "agent", name: "小未", ownerId: "me", online: true };
const human: Actor = { id: "u2", kind: "human", name: "同事" };

const dm = (peer: Actor): Conversation => ({
	id: "c-1",
	kind: "dm",
	title: peer.name,
	memberIds: ["me", peer.id],
	unread: 0,
});
const group = (members: Actor[], title = "项目群"): Conversation => ({
	id: "c-1",
	kind: "group",
	title,
	memberIds: ["me", ...members.map((m) => m.id)],
	unread: 0,
});

let container: HTMLElement;
let root: Root;
beforeEach(() => {
	const { document, window } = parseHTML("<html><body></body></html>");
	vi.stubGlobal("window", window);
	vi.stubGlobal("document", document);
	vi.stubGlobal("location", { href: "https://preview.test/c/c-1", origin: "https://preview.test", search: "" });
	vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	window.HTMLElement.prototype.scrollIntoView = vi.fn();
	container = document.createElement("div") as unknown as HTMLElement;
	document.body.appendChild(container as never);
	root = createRoot(container);
	$session.set({ actor: me });
	api.messages.mockResolvedValue([]);
	api.conversationDetail.mockResolvedValue({ id: "c-1", kind: "group", title: "项目群", members: [] });
	api.contacts.mockResolvedValue([]);
	api.subscribe.mockReturnValue(() => {});
});

afterEach(async () => {
	await act(() => root.unmount());
	$session.set(undefined);
	vi.unstubAllGlobals();
	vi.resetAllMocks();
});

async function show(conv: Conversation, actors: Actor[]) {
	api.conversations.mockResolvedValue([conv]);
	api.actors.mockResolvedValue(actors);
	await act(async () =>
		root.render(
			<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
				<MemoryRouter initialEntries={["/c/c-1"]}>
					<Routes>
						<Route path="/c/:id" element={<ConversationPage />} />
					</Routes>
				</MemoryRouter>
			</QueryClientProvider>,
		),
	);
	await act(async () => new Promise((resolve) => setTimeout(resolve, 30)));
}

it("与 Bot 的私聊在输入条上方显示一行 AI 生成标识", async () => {
	await show(dm(bot), [bot]);
	const label = [...container.querySelectorAll("p")].filter((p) => p.textContent === "内容由 AI 生成");
	expect(label).toHaveLength(1);
	// 紧接在输入条之前：标识出现在 textarea 之前。
	const composer = container.querySelector("textarea");
	expect(composer).toBeTruthy();
	expect(label[0].compareDocumentPosition(composer as never) & 4).toBe(4);
});

it("与人的私聊不显示标识", async () => {
	await show(dm(human), [human]);
	expect(container.querySelector("textarea")).toBeTruthy();
	expect(container.textContent).not.toContain("内容由 AI 生成");
});

it("有 Bot 成员的群显示标识，纯人群不显示", async () => {
	await show(group([human, bot]), [human, bot]);
	expect(container.textContent).toContain("内容由 AI 生成");
	await act(() => root.unmount());
	root = createRoot(container);
	await show(group([human]), [human]);
	expect(container.textContent).not.toContain("内容由 AI 生成");
});
