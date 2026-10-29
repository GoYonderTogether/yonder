import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import { SessionSources } from "../src/work/features/SessionSources";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("../src/work/api/client", () => ({ rpc }));

test("opens Bot sources separately and pages session trace through an empty page", async () => {
	const { window } = parseHTML("<html><body><div id='root'></div></body></html>");
	vi.stubGlobal("window", window);
	vi.stubGlobal("document", window.document);
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	const container = window.document.getElementById("root") as unknown as HTMLElement;
	const root = createRoot(container);
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	rpc.mockImplementation(
		async (method: string, params: { id?: string; after?: string; query?: { agent?: string; type?: string } }) => {
			if (method === "sessions.transcript") return { items: [], hasMore: false };
			if (method === "events.query" && params.query?.type === "social.folded-ready")
				return {
					events: [
						{
							id: "folded",
							ts: "time",
							conv: "conv:test:group",
							data: { agent: "bot", summary: "2 条消息：讨论发布" },
						},
						{ id: "other", ts: "time", data: { agent: "other", summary: "其他 Bot 内容" } },
					],
				};
			if (method === "events.query" && params.query?.agent === "bot")
				return {
					events: [
						{
							id: "source",
							ts: "time",
							conv: "conv:test:group",
							data: { kind: "group", text: "group message" },
							routes: [{ agent: "bot", binding: "group", session: "other" }],
						},
					],
				};
			if (method === "sessions.trace" && params.id === "main")
				return params.after
					? { events: [{ id: "unknown", ts: "time", type: "message.unknown", data: { reason: "uncertain" } }] }
					: { events: [], next: "cursor" };
			throw new Error(`Unexpected ${method}`);
		},
	);
	try {
		await act(async () => {
			root.render(
				<QueryClientProvider client={client}>
					<SessionSources session="main" agent="bot" />
				</QueryClientProvider>,
			);
		});
		await vi.waitFor(() => expect(container.textContent).toContain("Bot 级来源"));
		const sections = [...container.querySelectorAll("details")];
		await act(async () => {
			for (const section of sections) {
				section.setAttribute("open", "");
				section.dispatchEvent(new window.Event("toggle"));
			}
		});
		await vi.waitFor(() => expect(container.textContent).toContain("本页没有会话事件"));
		await vi.waitFor(() => expect(container.textContent).toContain("group message"));
		await vi.waitFor(() => expect(container.textContent).toContain("2 条消息：讨论发布"));
		expect(container.textContent).not.toContain("其他 Bot 内容");
		expect(container.querySelector('a[href="#/s/other"]')).not.toBeNull();
		const next = [...container.querySelectorAll("button")].find((button) => button.textContent === "下一页");
		await act(async () => next?.dispatchEvent(new window.Event("click", { bubbles: true })));
		await vi.waitFor(() => expect(container.textContent).toContain("message.unknown"));
		expect(rpc).toHaveBeenCalledWith("sessions.trace", { id: "main", after: "cursor" });
	} finally {
		await act(async () => root.unmount());
		client.clear();
		vi.unstubAllGlobals();
		rpc.mockReset();
	}
});
