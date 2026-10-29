import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SocialError } from "../../src/api/social/http";
import { ContactDetail } from "../../src/features/social/ContactDetail";

/**
 * 资料页有三种不同结局：接口不存在/不可达（网关没代理社交）、加载失败（可重试）、查无此人（真的 404 结果）。
 * 之前两种错误都落进「联系人不存在或无法访问」，把节点缺社交服务说成资料不存在。
 */
const state = vi.hoisted(() => ({ actor: {} as Record<string, unknown> }));
vi.mock("@tanstack/react-query", () => ({
	// 只有 ["contact", id] 由用例控制；session/profile/devices 一律成功且为空。
	useQuery: ({ queryKey }: { queryKey: unknown[] }) =>
		queryKey[0] === "contact" ? state.actor : { data: queryKey[0] === "devices" ? [] : null, isPending: false },
	useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("../../src/api/social", () => ({
	httpApi: {
		resolve: vi.fn(),
		actors: vi.fn(),
		profile: vi.fn(),
		devices: vi.fn(),
		session: vi.fn(),
		openDm: vi.fn(),
	},
}));
vi.mock("../../src/ui/kit/Toast", () => ({ toast: vi.fn() }));
vi.mock("../../src/ui/kit/Button", () => ({ Button: () => null }));
vi.mock("../../src/features/social/DeviceSheet", () => ({ Switch: () => null }));
vi.mock("../../src/features/social/IdentityDetail", () => ({
	IdentityDetail: ({ actor }: { actor: { name: string } }) => <div>资料 {actor.name}</div>,
}));

const actor = { id: "a1", name: "Alice", kind: "human" };

describe("ContactDetail", () => {
	beforeEach(() => {
		state.actor = { data: actor, isPending: false };
	});

	it("加载中", () => {
		state.actor = { isPending: true };
		expect(renderToStaticMarkup(<ContactDetail id="a1" />)).toContain("正在加载联系人");
	});

	it("正常显示资料", () => {
		expect(renderToStaticMarkup(<ContactDetail id="a1" />)).toContain("资料 Alice");
	});

	it("网关 404（没有代理社交接口）说明当前节点没有社交服务", () => {
		state.actor = { isPending: false, isError: true, error: new SocialError(404, "not_found"), refetch: vi.fn() };
		const html = renderToStaticMarkup(<ContactDetail id="a1" />);
		expect(html).toContain("当前节点没有提供社交服务");
		expect(html).toContain("重试");
		expect(html).not.toContain("联系人不存在或无法访问");
	});

	it("fetch 失败归为没有社交服务，不暴露原始 TypeError", () => {
		state.actor = { isPending: false, isError: true, error: new TypeError("Failed to fetch"), refetch: vi.fn() };
		const html = renderToStaticMarkup(<ContactDetail id="a1" />);
		expect(html).toContain("当前节点没有提供社交服务");
		expect(html).not.toContain("Failed to fetch");
	});

	it("其他加载失败给明确错误与重试", () => {
		state.actor = { isPending: false, isError: true, error: new SocialError(500, "boom"), refetch: vi.fn() };
		const html = renderToStaticMarkup(<ContactDetail id="a1" />);
		expect(html).toContain("加载联系人失败");
		expect(html).toContain("boom");
		expect(html).toContain("重试");
		expect(html).not.toContain("当前节点没有提供社交服务");
	});

	it("接口存在但查无此人时才是「不存在」，并给添加好友入口", () => {
		state.actor = { data: null, isPending: false };
		const html = renderToStaticMarkup(<ContactDetail id="missing" />);
		expect(html).toContain("联系人不存在或无法访问");
		expect(html).toContain("添加好友");
		expect(html).not.toContain("当前节点没有提供社交服务");
	});
});
