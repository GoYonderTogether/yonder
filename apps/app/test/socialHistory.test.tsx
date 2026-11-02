import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ConversationDetail, Message } from "../src/api/types";
import { ChatHistory, historySummary } from "../src/components/chat/ChatHistory";
import { useSocialRealtime } from "../src/lib/socialRealtime";
import { ConversationBody } from "../src/pages/Chat";

const api = vi.hoisted(() => ({
	messages: vi.fn(),
	conversations: vi.fn(),
	actors: vi.fn(),
	markRead: vi.fn(),
	subscribe: vi.fn(() => () => {}),
}));
vi.mock("../src/api", () => ({ api }));
vi.mock("../src/components/chat/OwnerTranscript", () => ({
	useOwnerConversation: () => ({}),
	OwnerTranscript: () => null,
}));
vi.mock("../src/components/VerifySheet", () => ({ VerifySheet: () => null }));
let root: Root;
let box: HTMLElement;
let client: QueryClient;
const message = (seq: number) => ({
	id: `m${seq}`,
	convId: "c1",
	senderId: "u1",
	seq,
	content: { type: "text", text: `消息${seq}` },
	createdAt: seq * 1000,
});
beforeEach(() => {
	const { document, window } = parseHTML("<html><body></body></html>");
	vi.stubGlobal("window", window);
	vi.stubGlobal("document", document);
	vi.stubGlobal("location", { search: "" });
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	window.HTMLElement.prototype.scrollIntoView = () => {};
	box = document.createElement("div") as unknown as HTMLElement;
	document.body.appendChild(box as never);
	root = createRoot(box);
	client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	api.conversations.mockResolvedValue([{ id: "c1", kind: "notice", title: "消息", memberIds: [], unread: 0 }]);
	api.actors.mockResolvedValue([]);
	api.markRead.mockResolvedValue(undefined);
});
afterEach(async () => {
	await act(() => root.unmount());
	client.clear();
	vi.clearAllMocks();
	vi.unstubAllGlobals();
});
function Realtime() {
	useSocialRealtime();
	return null;
}
async function mount() {
	await act(async () => {
		root.render(
			<QueryClientProvider client={client}>
				<MemoryRouter>
					<Realtime />
					<ConversationBody id="c1" routeRef="c1" />
				</MemoryRouter>
			</QueryClientProvider>,
		);
		await new Promise((resolve) => setTimeout(resolve, 30));
	});
}

test("a short initial page at seq 2 is the oldest history despite the missing seq 1", async () => {
	api.messages.mockResolvedValue([message(2)]);
	await mount();
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 30));
	});
	expect(box.textContent).toContain("消息2");
	expect(box.textContent).not.toContain("加载更早的消息");
	expect(api.messages).toHaveBeenCalledTimes(1);
});

test("an empty older page terminates history without repeatedly requesting a missing sequence", async () => {
	api.messages.mockResolvedValueOnce(Array.from({ length: 80 }, (_, i) => message(100 + i))).mockResolvedValueOnce([]);
	await mount();
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 30));
	});
	const older = [...box.querySelectorAll("button")].find((el) => el.textContent === "加载更早的消息");
	expect(older).toBeDefined();
	await act(async () => {
		older?.dispatchEvent(new window.Event("click", { bubbles: true }));
		await new Promise((resolve) => setTimeout(resolve, 30));
	});
	expect(box.textContent).not.toContain("加载更早的消息");
	expect(api.messages).toHaveBeenCalledTimes(2);
	expect(api.messages).toHaveBeenLastCalledWith("c1", { before: 100, limit: 40 });
});

test("gap and socket-only reconnect reconcile the active message window", async () => {
	api.messages
		.mockResolvedValueOnce([message(1)])
		.mockResolvedValueOnce([message(1), message(2), message(3)])
		.mockResolvedValue([message(1), message(2), message(3), message(4)]);
	await mount();
	const [receive, reconnect] = api.subscribe.mock.calls.at(-1) as unknown as [(m: unknown) => void, () => void];
	await act(async () => {
		receive(message(3));
		await new Promise((resolve) => setTimeout(resolve, 30));
	});
	expect(client.getQueryData(["msgs", "c1"])).toEqual([message(1), message(2), message(3)]);
	await act(async () => {
		reconnect();
		await new Promise((resolve) => setTimeout(resolve, 30));
	});
	expect(box.textContent).toContain("消息4");
	expect(api.messages).toHaveBeenCalledTimes(3);
});

test("reconnect preserves a manually paged historical window", async () => {
	api.messages
		.mockResolvedValueOnce(Array.from({ length: 80 }, (_, i) => message(100 + i)))
		.mockResolvedValueOnce(Array.from({ length: 40 }, (_, i) => message(60 + i)));
	await mount();
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 30));
	});
	const older = [...box.querySelectorAll("button")].find((el) => el.textContent === "加载更早的消息");
	await act(async () => {
		older?.dispatchEvent(new window.Event("click", { bubbles: true }));
		await new Promise((resolve) => setTimeout(resolve, 30));
	});
	const historical = client.getQueryData(["msgs", "c1"]);
	const [, reconnect] = api.subscribe.mock.calls.at(-1) as unknown as [unknown, () => void];
	await act(async () => {
		reconnect();
		await new Promise((resolve) => setTimeout(resolve, 30));
	});
	expect(client.getQueryData(["msgs", "c1"])).toEqual(historical);
	expect(api.messages).toHaveBeenCalledTimes(2);
});

test("history search and preview keep the server error text accessible and outside a message bubble", () => {
	const errorMessage: Message = {
		id: "error-1",
		convId: "c1",
		seq: 1,
		senderId: "bot",
		content: { type: "error", text: "云端 Bot 当前不可用" },
		createdAt: 1000,
	};
	const detail = { id: "c1", kind: "dm", title: "Bot", members: [] } as ConversationDetail;
	const html = renderToStaticMarkup(
		<QueryClientProvider client={new QueryClient()}>
			<ChatHistory d={detail} preview={errorMessage} onPreviewChange={() => {}} />
		</QueryClientProvider>,
	);
	expect(historySummary(errorMessage)).toBe("云端 Bot 当前不可用");
	expect(html).toContain('role="alert"');
	expect(html).toContain("text-danger");
	expect(html).toContain("云端 Bot 当前不可用");
	expect(html).not.toContain("rounded-card bg-tone");
});
