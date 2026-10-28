import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Contacts } from "../../src/features/social/Contacts";

const state = vi.hoisted(() => ({ contacts: {} as Record<string, unknown> }));
vi.mock("@tanstack/react-query", () => ({
	useQuery: ({ queryKey }: { queryKey: string[] }) =>
		queryKey[0] === "contacts"
			? state.contacts
			: queryKey[0] === "devices"
				? { data: [], isPending: false }
				: { data: { actor: { id: "me" } } },
	useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("../../src/api/social", () => ({
	httpApi: { contacts: vi.fn(), devices: vi.fn(), session: vi.fn(), conversations: vi.fn() },
}));
describe("Contacts", () => {
	beforeEach(() => {
		state.contacts = { isPending: false, data: [] };
	});
	it("显示加载状态", () => {
		state.contacts = { isPending: true };
		expect(renderToStaticMarkup(<Contacts />)).toContain("正在加载联系人");
	});
	it("显示空状态", () => {
		expect(renderToStaticMarkup(<Contacts />)).toContain("暂无联系人");
	});
	it("显示联系人", () => {
		state.contacts = { isPending: false, data: [{ id: "1", name: "Alice", kind: "human" }] };
		expect(renderToStaticMarkup(<Contacts />)).toContain("Alice");
	});
	it("显示错误状态", () => {
		state.contacts = { isPending: false, isError: true };
		expect(renderToStaticMarkup(<Contacts />)).toContain("加载联系人失败");
	});
});
