import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatShell } from "../src/pages/Chat";

const api = vi.hoisted(() => ({
	conversations: vi.fn(),
	actors: vi.fn(),
	subscribe: vi.fn(() => () => {}),
	devices: vi.fn(),
}));
vi.mock("../src/api", () => ({ api }));
vi.mock("../src/components/chat/DeviceRow", () => ({ DeviceRow: () => null }));

let container: HTMLElement;
let root: Root;
const calls: { url: string; body: unknown }[] = [];
beforeEach(() => {
	const { document, window } = parseHTML("<html><body></body></html>");
	vi.stubGlobal("window", window);
	vi.stubGlobal("document", document);
	vi.stubGlobal("location", { href: "http://localhost:5180/", origin: "http://localhost:5180" });
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	container = document.createElement("div") as unknown as HTMLElement;
	document.body.appendChild(container as never);
	root = createRoot(container);
	vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
	calls.length = 0;
	api.actors.mockResolvedValue([]);
	api.devices.mockResolvedValue([]);
	// 记录 RPC 形状的网关：只回答 bots.list。
	vi.stubGlobal("fetch", async (url: URL, init: { body: string }) => {
		calls.push({ url: String(url), body: JSON.parse(init.body) });
		return new Response(
			JSON.stringify({ ok: true, result: { bots: [{ agent: "main", name: "小约", session: "s1 x" }] } }),
		);
	});
});
afterEach(async () => {
	await act(() => root.unmount());
	vi.unstubAllGlobals();
});

async function render() {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	await act(async () =>
		root.render(
			<QueryClientProvider client={client}>
				<MemoryRouter initialEntries={["/"]}>
					<ChatShell />
				</MemoryRouter>
			</QueryClientProvider>,
		),
	);
	await act(async () => {
		await new Promise((r) => setTimeout(r, 20));
	});
}

describe("消息页（节点没有社交服务）", () => {
	it("列出 bots.list 的 Bot，并链接到工作页的同一个主会话", async () => {
		api.conversations.mockRejectedValue(Object.assign(new Error("Not Found"), { status: 404 }));
		await render();
		expect(calls.map((c) => c.url.split("/api/rpc/")[1])).toContain("bots.list");
		const a = container.querySelector("a");
		expect(a?.textContent).toContain("小约");
		expect(a?.getAttribute("href")).toBe("/work/s1%20x");
	});

	it("有社交服务时保持原行为，不请求 bots.list", async () => {
		api.conversations.mockResolvedValue([]);
		await render();
		expect(calls).toHaveLength(0);
		expect(container.textContent).toContain("没有匹配的会话");
	});
});
