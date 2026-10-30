import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router";
import { expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ conversations: vi.fn(), messages: vi.fn(), actors: vi.fn(), openDm: vi.fn() }));
vi.mock("../src/api", () => ({ api }));
vi.mock("../src/ui/Toast", () => ({ toast: vi.fn() }));
const { Conversation } = await import("../src/pages/Chat");

it("消息 403 即使 UUID 对应账号也不打开私聊", async () => {
	const { document, window } = parseHTML("<html><body></body></html>");
	vi.stubGlobal("window", window);
	vi.stubGlobal("document", document);
	vi.stubGlobal("location", { pathname: "/", search: "" });
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	window.HTMLElement.prototype.scrollIntoView = vi.fn();
	const container = document.createElement("div") as unknown as HTMLElement;
	document.body.appendChild(container as never);
	const root = createRoot(container);
	const id = "2316f71f-5994-47b3-8661-125ec05e67c5";
	api.conversations.mockResolvedValue([]);
	api.messages.mockRejectedValue({ status: 403 });
	api.actors.mockResolvedValue([{ id, kind: "human", name: "账号" }]);
	try {
		await act(async () =>
			root.render(
				<QueryClientProvider client={new QueryClient()}>
					<MemoryRouter initialEntries={[`/c/${id}`]}>
						<Routes>
							<Route path="/c/:id" element={<Conversation />} />
						</Routes>
					</MemoryRouter>
				</QueryClientProvider>,
			),
		);
		await act(async () => new Promise((resolve) => setTimeout(resolve, 30)));
		expect(container.textContent).toContain("无权访问这个会话");
		expect(api.openDm).not.toHaveBeenCalled();
		expect(api.actors).not.toHaveBeenCalledWith([id]);
	} finally {
		await act(() => root.unmount());
		vi.unstubAllGlobals();
	}
});
