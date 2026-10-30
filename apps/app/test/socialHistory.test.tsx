import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ConversationBody } from "../src/pages/Chat";

const api = vi.hoisted(() => ({ messages: vi.fn(), conversations: vi.fn(), actors: vi.fn(), markRead: vi.fn() }));
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
async function mount() {
	await act(async () => {
		root.render(
			<QueryClientProvider client={client}>
				<MemoryRouter>
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
