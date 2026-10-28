import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AddFriend } from "../../src/features/social/AddFriend";

const state = vi.hoisted(() => ({ cards: {} as Record<string, unknown> }));
vi.mock("@tanstack/react-query", () => ({
	useQuery: ({ queryKey }: { queryKey: string[] }) => (queryKey[0] === "cards" ? state.cards : {}),
	useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("../../src/api/social", () => ({
	httpApi: { cards: vi.fn(), resolve: vi.fn(), card: vi.fn(), profile: vi.fn() },
}));

describe("AddFriend", () => {
	beforeEach(() => {
		vi.stubGlobal("location", { hash: "" });
		state.cards = { data: [] };
	});
	it("显示加载状态", () => {
		state.cards = { isPending: true };
		expect(renderToStaticMarkup(<AddFriend />)).toContain("正在加载名片");
	});
	it("显示空状态", () => {
		expect(renderToStaticMarkup(<AddFriend />)).toContain("暂无名片");
	});
	it("显示名片", () => {
		state.cards = { data: [{ id: "1", title: "我的名片", mine: true }] };
		expect(renderToStaticMarkup(<AddFriend />)).toContain("我的名片");
	});
	it("显示错误状态", () => {
		state.cards = { isError: true };
		expect(renderToStaticMarkup(<AddFriend />)).toContain("加载名片失败");
	});
});
