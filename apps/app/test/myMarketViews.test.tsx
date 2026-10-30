import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { expect, it, vi } from "vitest";
import { MyMarket } from "../src/components/market/MarketStats";

const mk = (id: string, metricSource?: "sample") => ({
	id,
	mine: true,
	metricSource,
	metrics: { agentViews: 2000, humanViews: 814, shortlists: 0, inquiries: 0 },
});
const state = vi.hoisted(() => ({ listings: [] as unknown[], saved: [] as string[], liked: [] as string[] }));
vi.mock("../src/market/store", () => ({
	useMarketState: () => ({ state: { saved: state.saved, liked: state.liked, tasks: [] } }),
}));
vi.mock("../src/api", () => ({
	api: { marketListings: () => Promise.resolve(state.listings) },
}));

async function render() {
	const { document, window } = parseHTML("<html><body></body></html>");
	vi.stubGlobal("window", window);
	vi.stubGlobal("document", document);
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	const el = document.createElement("div");
	document.body.appendChild(el);
	const root = createRoot(el as never);
	await act(() =>
		root.render(
			<QueryClientProvider client={new QueryClient()}>
				<MemoryRouter>
					<MyMarket />
				</MemoryRouter>
			</QueryClientProvider>,
		),
	);
	// 等 useQuery 的 promise 与 React Query 的通知定时器落地后再读文案（否则读到的是加载中的空列表）
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
	return el.textContent ?? "";
}

it("示例数据不显示浏览数（UX-04）", async () => {
	state.listings = [mk("a", "sample")];
	expect(await render()).not.toContain("次浏览");
});

it("真实发布显示真实浏览数", async () => {
	state.listings = [mk("a", "sample"), mk("b")];
	expect(await render()).toContain("2,814 次浏览");
});

it("收藏/点赞只统计服务端还在的帖子，并提示失效收藏（B3）", async () => {
	state.listings = [mk("a")];
	state.saved = ["a", "gone"];
	state.liked = ["a"];
	const text = await render();
	expect(text).toContain("收藏1");
	expect(text).toContain("点赞1");
	expect(text).toContain("有 1 条收藏已失效");
});
