import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { Profile } from "../../src/features/social/Profile";

function render(client: QueryClient) {
	return renderToStaticMarkup(
		<QueryClientProvider client={client}>
			<Profile accountId="actor-id" />
		</QueryClientProvider>,
	);
}
function client() {
	const query = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } });
	query.setQueryData(["social-session"], null);
	return query;
}
describe("Profile", () => {
	it("shows loading", () => {
		expect(render(client())).toContain("正在加载资料");
	});
	it("shows an empty profile", () => {
		const query = client();
		query.setQueryData(["profile", "actor-id"], null);
		expect(render(query)).toContain("这个资料不存在或无法访问");
	});
	it("shows profile data", () => {
		const query = client();
		query.setQueryData(["profile", "actor-id"], {
			actor: { id: "actor-id", name: "测试用户", kind: "human" },
			summary: "介绍",
			card: null,
			agents: [],
			owner: null,
		});
		expect(render(query)).toContain("测试用户");
	});
	it("shows errors", async () => {
		const query = client();
		await query
			.fetchQuery({ queryKey: ["profile", "actor-id"], queryFn: () => Promise.reject(new Error("failed")) })
			.catch(() => {});
		expect(render(query)).toContain("加载资料失败");
	});
});

describe("Me", () => {
	it("shows the account and owned agents with their public switch", () => {
		const query = client();
		query.setQueryData(["social-session"], { actor: { id: "owner", name: "主人", kind: "human" } });
		query.setQueryData(
			["contacts"],
			[
				{ id: "agent", name: "我的 Agent", kind: "agent", ownerId: "owner", public: true },
				{ id: "other", name: "别人的 Agent", kind: "agent", ownerId: "other" },
			],
		);
		const html = renderToStaticMarkup(
			<QueryClientProvider client={query}>
				<Profile />
			</QueryClientProvider>,
		);
		expect(html).toContain("主人");
		expect(html).toContain("我的 Agent");
		expect(html).toContain("公开到我的个人主页");
		expect(html).not.toContain("别人的 Agent");
	});
	it("shows login without a social session", () => {
		const query = client();
		vi.stubGlobal("location", { search: "", hash: "" });
		try {
			const html = renderToStaticMarkup(
				<QueryClientProvider client={query}>
					<Profile />
				</QueryClientProvider>,
			);
			expect(html).toContain("登录");
		} finally {
			vi.unstubAllGlobals();
		}
	});
});
