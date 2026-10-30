import { describe, expect, it } from "vitest";
import { upgradeMarketState } from "../src/market/catalog";
import { initialMarketState } from "../src/market/data";

describe("upgradeMarketState（B4：不再把帖子写进 localStorage）", () => {
	it("读取旧状态时丢弃 listings 字段，保留收藏与点赞", () => {
		const legacy = {
			version: 2,
			listings: [{ id: "old", image: "data:image/png;base64,AAAA" }],
			tasks: [],
			saved: ["s1"],
			liked: ["l1"],
			compare: ["s1"],
			inquiries: [],
		};
		const state = upgradeMarketState(legacy, initialMarketState());
		expect("listings" in state).toBe(false);
		expect(state.saved).toEqual(["s1"]);
		expect(state.liked).toEqual(["l1"]);
		expect(state.compare).toEqual(["s1"]);
	});

	it("新状态不含 listings 字段", () => {
		expect("listings" in initialMarketState()).toBe(false);
	});

	it("旧状态的集合字段损坏时回到初始状态", () => {
		const initial = initialMarketState();
		const state = upgradeMarketState({ saved: "oops" } as never, initial);
		expect(state).toEqual(initial);
	});
});
