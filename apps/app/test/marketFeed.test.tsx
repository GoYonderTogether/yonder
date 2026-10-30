import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Market } from "../src/pages/Market";

const api = vi.hoisted(() => ({ marketListings: vi.fn(), contacts: vi.fn().mockResolvedValue([]) }));
vi.mock("../src/api", () => ({ api }));
vi.mock("../src/ui/Toast", () => ({ toast: vi.fn() }));

let container: HTMLElement;
let root: Root;

beforeEach(() => {
	const { document, window } = parseHTML("<html><body></body></html>");
	vi.stubGlobal("window", window);
	vi.stubGlobal("document", document);
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	// linkedom 没有 scrollTo；Market 的滚动恢复会调用它。
	Object.getPrototypeOf(document.createElement("div")).scrollTo = () => {};
	const store = new Map<string, string>();
	vi.stubGlobal("localStorage", {
		getItem: (key: string) => store.get(key) ?? null,
		setItem: (key: string, value: string) => void store.set(key, String(value)),
		removeItem: (key: string) => void store.delete(key),
	});
	api.contacts.mockResolvedValue([]);
	container = document.createElement("div") as unknown as HTMLElement;
	document.body.appendChild(container as never);
	root = createRoot(container);
});

afterEach(async () => {
	await act(() => root.unmount());
	vi.unstubAllGlobals();
	vi.resetAllMocks();
});

async function render() {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	await act(async () => {
		root.render(
			<QueryClientProvider client={client}>
				<MemoryRouter initialEntries={["/market"]}>
					<Market />
				</MemoryRouter>
			</QueryClientProvider>,
		);
	});
	// React Query 的 promise + 通知定时器要多轮宏任务才落地，每轮单独 act 才能刷到界面
	for (let i = 0; i < 4; i++) {
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0));
		});
	}
	return container.textContent ?? "";
}

describe("市场列表加载态（B2）", () => {
	it("加载中显示骨架，不显示「市场还没有帖子」", async () => {
		api.marketListings.mockReturnValue(new Promise(() => {}));
		const text = await render();
		expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
		expect(text).toContain("正在加载市场");
		expect(text).not.toContain("市场还没有帖子");
	});

	it("加载失败显示重试，不显示「市场还没有帖子」", async () => {
		api.marketListings.mockRejectedValue(new Error("network"));
		const text = await render();
		expect(text).toContain("加载失败");
		const retry = Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.includes("重试"));
		expect(retry).not.toBeUndefined();
		expect(text).not.toContain("市场还没有帖子");
	});

	it("空市场才显示「市场还没有帖子」", async () => {
		api.marketListings.mockResolvedValue([]);
		const text = await render();
		expect(text).toContain("市场还没有帖子");
	});
});
