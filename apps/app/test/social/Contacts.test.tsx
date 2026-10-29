import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SocialError } from "../../src/api/social/http";
import { Contacts } from "../../src/features/social/Contacts";

const state = vi.hoisted(() => ({ contacts: {} as Record<string, unknown>, devices: {} as Record<string, unknown> }));
vi.mock("@tanstack/react-query", () => ({
	useQuery: ({ queryKey }: { queryKey: string[] }) =>
		queryKey[0] === "contacts"
			? state.contacts
			: queryKey[0] === "devices"
				? state.devices
				: { data: { actor: { id: "me" } } },
	useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("../../src/api/social", () => ({
	httpApi: { contacts: vi.fn(), devices: vi.fn(), session: vi.fn(), conversations: vi.fn() },
}));
describe("Contacts", () => {
	beforeEach(() => {
		state.contacts = { isPending: false, data: [] };
		state.devices = { data: [], isPending: false };
	});
	it("显示加载状态", () => {
		state.contacts = { isPending: true };
		expect(renderToStaticMarkup(<Contacts />)).toContain("正在加载联系人");
	});
	it("真的没有联系人时给空态和添加好友入口", () => {
		const html = renderToStaticMarkup(<Contacts />);
		expect(html).toContain("暂无联系人");
		expect(html).toContain("添加好友");
		expect(html).not.toContain("加载联系人失败");
	});
	it("显示联系人", () => {
		state.contacts = { isPending: false, data: [{ id: "1", name: "Alice", kind: "human" }] };
		expect(renderToStaticMarkup(<Contacts />)).toContain("Alice");
	});
	it("接口不存在（404）时说当前节点没有社交服务，而不是空列表", () => {
		state.contacts = { isPending: false, isError: true, error: new SocialError(404, "not_found") };
		const html = renderToStaticMarkup(<Contacts />);
		expect(html).toContain("当前节点没有提供社交服务");
		expect(html).toContain("重试");
		expect(html).not.toContain("暂无联系人");
	});
	it("fetch 失败（网络不可达）同样归为没有社交服务", () => {
		state.contacts = { isPending: false, isError: true, error: new TypeError("Failed to fetch") };
		const html = renderToStaticMarkup(<Contacts />);
		expect(html).toContain("当前节点没有提供社交服务");
		expect(html).not.toContain("Failed to fetch");
	});
	it("其他失败显示明确错误与重试，不说成没有服务", () => {
		state.contacts = { isPending: false, isError: true, error: new SocialError(500, "boom") };
		const html = renderToStaticMarkup(<Contacts />);
		expect(html).toContain("加载联系人失败");
		expect(html).toContain("boom");
		expect(html).toContain("重试");
		expect(html).not.toContain("当前节点没有提供社交服务");
		expect(html).not.toContain("暂无联系人");
	});
	it("devices 失败与 contacts 失败同样处理", () => {
		state.devices = { isPending: false, isError: true, error: new SocialError(404, "not_found") };
		expect(renderToStaticMarkup(<Contacts />)).toContain("当前节点没有提供社交服务");
	});
});
