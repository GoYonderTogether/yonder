import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.hoisted(() => vi.fn());
vi.mock("@tanstack/react-query", () => ({
	useQuery: query,
	useMutation: () => ({ mutate: vi.fn() }),
	useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("../../src/shell/routes", () => ({ useRoute: () => ({ page: "cards" }), href: () => "#/u/card" }));

import { CardPage } from "../../src/features/social/CardPage";

beforeEach(() => {
	query.mockReset();
	vi.stubGlobal("location", { origin: "https://example.test", pathname: "/" });
});
const actor = { id: "a", name: "小明", kind: "human" };
const card = {
	id: "card",
	ownerId: "a",
	mine: true,
	status: "published",
	title: "名片",
	summary: null,
	markdown: "",
	kind: "default",
	respondentId: "a",
	rev: 1,
	updatedAt: 0,
};
function render(session: object, cards: object, contacts: object) {
	query.mockReturnValueOnce(session).mockReturnValueOnce(cards).mockReturnValueOnce(contacts);
	return renderToStaticMarkup(<CardPage />);
}
describe("CardPage", () => {
	it("renders loading", () => expect(render({ isPending: true }, {}, {})).toContain("正在加载名片"));
	it("renders empty", () => expect(render({ data: null }, { data: [] }, { data: [] })).toContain("暂无名片"));
	it("renders cards", () => expect(render({ data: { actor } }, { data: [card] }, { data: [] })).toContain("小明"));
	it("renders error", () => expect(render({ isError: true }, {}, {})).toContain("加载名片失败"));
});
