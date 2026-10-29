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
const state = vi.hoisted(() => ({ listings: [] as unknown[] }));
vi.mock("../src/market/store", () => ({
	useMarketState: () => ({ state: { listings: state.listings, saved: [], liked: [], tasks: [] } }),
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
			<MemoryRouter>
				<MyMarket />
			</MemoryRouter>,
		),
	);
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
