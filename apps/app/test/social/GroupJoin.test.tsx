import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { type GroupPreview, httpApi } from "../../src/work/api/social";
import { GroupJoin } from "../../src/work/features/social/GroupJoin";

vi.mock("../../src/work/api/social", () => ({ httpApi: { groupPreview: vi.fn(), session: vi.fn() } }));

const fixture: GroupPreview = {
	title: "群聊",
	memberCount: 1,
	members: [{ id: "1", kind: "human", name: "小明" }],
	member: false,
};
function render(client: QueryClient) {
	return renderToStaticMarkup(
		<QueryClientProvider client={client}>
			<GroupJoin token="invite" />
		</QueryClientProvider>,
	);
}
function client() {
	return new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false } } });
}
async function prepare(group: GroupPreview | null | Error) {
	const qc = client();
	vi.mocked(httpApi.session).mockResolvedValue(null);
	vi.mocked(httpApi.groupPreview).mockImplementation(async () => {
		if (group instanceof Error) throw group;
		return group;
	});
	await Promise.all([
		qc.prefetchQuery({ queryKey: ["group", "invite"], queryFn: () => httpApi.groupPreview("invite") }),
		qc.prefetchQuery({ queryKey: ["social-session"], queryFn: httpApi.session }),
	]);
	return qc;
}
describe("GroupJoin", () => {
	it("显示加载状态", () => expect(render(client())).toContain("加载中"));
	it("显示失效邀请", async () => expect(render(await prepare(null))).toContain("二维码已失效"));
	it("显示群信息和加入按钮", async () => {
		const html = render(await prepare(fixture));
		expect(html).toContain("群聊");
		expect(html).toContain("小明");
		expect(html).toContain("加入群聊");
	});
	it("显示请求错误", async () => expect(render(await prepare(new Error("failed")))).toContain("加载失败"));
});
