import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Contacts } from "../../src/ui/Contacts";

/**
 * 通讯录侧栏列出 sessions.list 里真实的常驻 Bot。失败、空、有数据是三种状态：
 * 失败必须给错误与重试，不能渲染成「没有常驻 Bot」。
 */
const state = vi.hoisted(() => ({ sessions: {} as Record<string, unknown> }));
vi.mock("../../src/lib/queries", () => ({
	useSessions: () => state.sessions,
	useTitleOf: () => (s: { id: string }) => `Bot ${s.id}`,
}));
vi.mock("../../src/lib/useHash", () => ({
	href: (route: Record<string, string>) => `#/${route.tab ?? ""}`,
}));
vi.mock("../../src/ui/Avatar", () => ({ Avatar: () => null }));

const bot = { id: "main", mode: "main", agent: "main", profile: "owner", key: "main", closed: undefined };

describe("ui/Contacts", () => {
	beforeEach(() => {
		state.sessions = { data: [], isLoading: false, isError: false };
	});

	it("加载中显示进度", () => {
		state.sessions = { isLoading: true };
		expect(renderToStaticMarkup(<Contacts />)).toContain("加载中");
	});

	it("列出常驻 Bot", () => {
		state.sessions = { data: [bot], isLoading: false, isError: false };
		expect(renderToStaticMarkup(<Contacts />)).toContain("Bot main");
	});

	it("失败显示明确错误与重试，不再画成空列表", () => {
		state.sessions = { isLoading: false, isError: true, refetch: vi.fn() };
		const html = renderToStaticMarkup(<Contacts />);
		expect(html).toContain("加载常驻 Bot 失败");
		expect(html).toContain("重试");
		expect(html).toContain('role="alert"');
		expect(html).not.toContain("没有常驻 Bot");
	});

	it("真的没有 Bot 时给空态与下一步入口", () => {
		const html = renderToStaticMarkup(<Contacts />);
		expect(html).toContain("没有常驻 Bot");
		expect(html).toContain("添加好友");
		expect(html).not.toContain("加载常驻 Bot 失败");
	});

	it("过滤已关闭的会话与非 Bot 会话", () => {
		state.sessions = {
			data: [bot, { ...bot, id: "old", closed: "2026-10-01" }, { ...bot, id: "task", mode: "task" }],
			isLoading: false,
			isError: false,
		};
		const html = renderToStaticMarkup(<Contacts />);
		expect(html).toContain("Bot main");
		expect(html).not.toContain("Bot old");
		expect(html).not.toContain("Bot task");
	});
});
