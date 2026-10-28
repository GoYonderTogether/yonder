import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SocialChat } from "../../src/features/social/SocialChat";

const state = vi.hoisted(() => ({ mode: "loading" }));
vi.mock("@tanstack/react-query", () => ({
	useQueryClient: () => ({ setQueryData: vi.fn(), invalidateQueries: vi.fn() }),
	useQuery: ({ queryKey }: { queryKey: string[] }) => {
		const name = queryKey[1];
		const data =
			name === "resolve"
				? { id: "c1", code: "chat" }
				: name === "conversation"
					? { id: "c1", kind: "dm", title: "小伙伴", members: [] }
					: name === "messages"
						? state.mode === "normal"
							? [{ id: "m1", senderId: "a", content: { type: "text", text: "你好" } }]
							: []
						: null;
		return {
			data,
			isLoading: state.mode === "loading" && name === "resolve",
			isError: state.mode === "error" && name === "resolve",
			refetch: vi.fn(),
		};
	},
}));
vi.mock("../../src/api/social", () => ({
	httpApi: {
		resolve: vi.fn(),
		conversationDetail: vi.fn(),
		messages: vi.fn(),
		session: vi.fn(),
		markRead: vi.fn(),
		groupInvite: vi.fn(),
	},
}));

describe("SocialChat", () => {
	beforeEach(() => {
		state.mode = "loading";
	});
	it("加载中", () => {
		expect(renderToStaticMarkup(<SocialChat id="chat" />)).toContain("正在加载会话");
	});
	it("空消息", () => {
		state.mode = "empty";
		expect(renderToStaticMarkup(<SocialChat id="chat" />)).toContain("还没有消息");
	});
	it("正常消息", () => {
		state.mode = "normal";
		expect(renderToStaticMarkup(<SocialChat id="chat" />)).toContain("你好");
	});
	it("加载失败", () => {
		state.mode = "error";
		expect(renderToStaticMarkup(<SocialChat id="chat" />)).toContain("会话加载失败");
	});
});
