import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Actor, ConversationDetail, Message } from "../src/api/types";
import { ChatDetail } from "../src/components/chat/ChatDetail";
import { historyDayRange } from "../src/components/chat/ChatHistory";
import { canAssignRole, canMuteMember, groupPermissions } from "../src/components/chat/groupPermissions";
import { groupMemberName, validateGroupNickname } from "../src/lib/groupMemberName";
import { $session } from "../src/store";

const api = vi.hoisted(() => ({
	conversationDetail: vi.fn(),
	groupInvite: vi.fn(),
	devices: vi.fn(),
	actors: vi.fn(),
}));
const chat = vi.hoisted(() => ({
	update: vi.fn(),
	setNickname: vi.fn(),
	setRole: vi.fn(),
	mute: vi.fn(),
	dissolve: vi.fn(),
	leave: vi.fn(),
	history: vi.fn(),
}));
const upload = vi.hoisted(() => vi.fn());
const layout = vi.hoisted(() => ({ desktop: false }));
vi.mock("../src/api", () => ({ api }));
vi.mock("../src/api/chat", async (original) => ({
	...(await original<typeof import("../src/api/chat")>()),
	chatApi: chat,
	uploadGroupAvatar: upload,
}));
vi.mock("../src/lib/useDesktop", () => ({ useDesktop: () => layout.desktop }));
vi.mock("../src/lib/useShareUrl", () => ({ useShareUrl: (_target: unknown, plain: string) => plain }));
let container: HTMLElement, root: Root, client: QueryClient;
const close = vi.fn(),
	select = vi.fn();
const me = { id: "me", name: "自己", kind: "human" } as Actor;
function group(): ConversationDetail {
	return {
		id: "group-test",
		kind: "group",
		title: "项目小组",
		members: [
			{ ...me, role: "owner" },
			{ id: "admin", name: "管理员甲", kind: "human", role: "admin" },
			{ id: "member", name: "成员乙", kind: "human", role: "member" },
			{ id: "bot", name: "助手丙", kind: "agent", role: "member" },
		],
	};
}
function message(
	id: string,
	seq: number,
	content: Message["content"] = { type: "text", text: `项目记录 ${id}` },
): Message {
	return {
		id,
		seq,
		convId: "group-test",
		senderId: "member",
		createdAt: new Date("2026-10-31T10:00:00").getTime(),
		content,
	};
}
beforeEach(() => {
	const { document, window } = parseHTML("<html><body></body></html>");
	vi.stubGlobal("window", window);
	vi.stubGlobal("document", document);
	vi.stubGlobal("location", { origin: "https://preview.test", href: "https://preview.test/c/group-test" });
	vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn() });
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	container = document.createElement("div") as unknown as HTMLElement;
	document.body.appendChild(container as never);
	root = createRoot(container);
	client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	api.conversationDetail.mockResolvedValue(group());
	api.devices.mockResolvedValue([]);
	api.actors.mockResolvedValue([]);
	chat.history.mockResolvedValue({ items: [], hasMore: false });
	layout.desktop = false;
	$session.set({ actor: me });
	close.mockClear();
	select.mockClear();
});
afterEach(async () => {
	await act(() => root.unmount());
	client.clear();
	$session.set(null);
	vi.unstubAllGlobals();
	vi.resetAllMocks();
});
async function flush() {
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
}
async function render() {
	await act(() =>
		root.render(
			<QueryClientProvider client={client}>
				<MemoryRouter>
					<ChatDetail convId="group-test" onClose={close} onSelectMessage={select} />
				</MemoryRouter>
			</QueryClientProvider>,
		),
	);
	await flush();
}
function button(text: string) {
	const button = [...container.querySelectorAll("button")].find((el) => el.textContent === text);
	expect(button).toBeDefined();
	return button as HTMLButtonElement;
}
async function click(text: string) {
	await act(async () => {
		button(text).dispatchEvent(new window.Event("click", { bubbles: true }));
	});
	await flush();
}
async function clickAria(label: string) {
	const el = container.querySelector(`button[aria-label="${label}"]`);
	expect(el).not.toBeNull();
	await act(async () => {
		el?.dispatchEvent(new window.Event("click", { bubbles: true }));
	});
	await flush();
}
async function change(selector: string, value: string) {
	const node = container.querySelector(selector) as HTMLElement;
	const key = Object.keys(node).find((k) => k.startsWith("__reactProps$"));
	const props = (node as unknown as Record<string, { onChange(e: unknown): void }>)[key ?? ""];
	await act(() => props.onChange({ target: { value } }));
}
async function member(name: string) {
	const entry = [...container.querySelectorAll("button")].find((el) => el.textContent?.startsWith("群成员"));
	await act(async () => {
		entry?.dispatchEvent(new window.Event("click", { bubbles: true }));
	});
	const row = [...container.querySelectorAll("button")].find((el) => el.textContent?.includes(name));
	await act(async () => {
		row?.dispatchEvent(new window.Event("click", { bubbles: true }));
	});
}
it("keeps legacy ownerless groups read-only without inferring the current user as owner", async () => {
	const d = group();
	d.members = d.members.map((m) => ({ ...m, role: "member" }));
	api.conversationDetail.mockResolvedValue(d);
	await render();
	expect(container.textContent).toContain("尚未记录群主");
	expect(button("退出群聊")).toBeDefined();
	expect(container.querySelector('button[aria-label="群名称"]')?.hasAttribute("disabled")).toBe(true);
	expect([...container.querySelectorAll("button")].some((el) => el.textContent === "解散群聊")).toBe(false);
	expect(groupPermissions(d, me).manage).toBe(false);
});
it("checks owner/admin boundaries for humans, bots and self", () => {
	const d = group(),
		admin = d.members[1],
		human = d.members[2],
		bot = d.members[3];
	expect(canAssignRole("owner", "me", human)).toBe(true);
	expect(canAssignRole("owner", "me", bot)).toBe(false);
	expect(canAssignRole("admin", "admin", human)).toBe(false);
	expect(canMuteMember("admin", "admin", bot)).toBe(true);
	expect(canMuteMember("admin", "admin", d.members[0])).toBe(false);
	expect(canMuteMember("admin", "member", admin)).toBe(false);
	expect(canMuteMember("owner", "me", admin)).toBe(true);
	expect(canMuteMember("owner", "me", d.members[0])).toBe(false);
	expect(groupPermissions(d, { ...me, anonymous: true }).manage).toBe(false);
});
it("warns an owner before leaving and offers transfer without mutating the group", async () => {
	await render();
	await click("退出群聊");
	expect(container.textContent).toContain("无法恢复");
	expect(container.textContent).toContain("直接退出也会解散");
	expect(chat.leave).not.toHaveBeenCalled();
	await click("先移交群主，保留群聊");
	expect(container.querySelector("h1")?.textContent).toBe("群成员");
	expect(close).not.toHaveBeenCalled();
});
it("uses one header to go back through transfer, member and member-list screens", async () => {
	await render();
	await member("成员乙");
	await click("移交群主");
	expect(container.querySelector("h1")?.textContent).toBe("移交群主");
	expect(container.textContent).not.toContain("返回群信息");
	await clickAria("返回");
	expect(container.querySelector("h1")?.textContent).toBe("成员设置");
	await clickAria("返回");
	expect(container.querySelector("h1")?.textContent).toBe("群成员");
	await clickAria("返回");
	expect(container.querySelector("h1")?.textContent).toBe("聊天详情");
	expect(close).not.toHaveBeenCalled();
});
it("requires confirmation for owner dissolve and sends the explicit dissolve action", async () => {
	chat.dissolve.mockResolvedValue(undefined);
	await render();
	await click("解散群聊");
	expect(chat.dissolve).not.toHaveBeenCalled();
	await click("确认解散并退出");
	expect(chat.dissolve).toHaveBeenCalledWith("group-test");
	expect(chat.leave).not.toHaveBeenCalled();
});
it("locks header navigation and member controls until a timed mute completes", async () => {
	layout.desktop = true;
	let finish!: (value: unknown) => void;
	chat.mute.mockImplementation(
		() =>
			new Promise((resolve) => {
				finish = resolve;
			}),
	);
	await render();
	await member("助手丙");
	await change("select", "3600");
	await click("禁言");
	expect(chat.mute).toHaveBeenCalledWith("group-test", "bot", 3600);
	expect((container.querySelector('button[aria-label="返回"]') as HTMLButtonElement).disabled).toBe(true);
	expect((container.querySelector('button[aria-label="关闭"]') as HTMLButtonElement).disabled).toBe(true);
	expect((container.querySelector("select") as HTMLSelectElement).disabled).toBe(true);
	await act(async () => finish({ mutedUntil: Date.now() + 3600000 }));
	await flush();
	expect((container.querySelector('button[aria-label="关闭"]') as HTMLButtonElement).disabled).toBe(false);
});
it("does not expose admin-only controls for the owner or another admin", async () => {
	$session.set({ actor: { id: "admin", name: "管理员甲", kind: "human" } });
	await render();
	await member("自己");
	expect(container.textContent).toContain("没有可用的管理操作");
	expect([...container.querySelectorAll("button")].some((el) => el.textContent === "禁言")).toBe(false);
});
it("has one history entry and keeps conversation pin in the existing preference store", async () => {
	await render();
	expect([...container.querySelectorAll("button")].filter((el) => el.textContent === "查找聊天记录")).toHaveLength(1);
	expect([...container.querySelectorAll("button")].some((el) => el.textContent === "图片")).toBe(false);
	const toggle = container.querySelector('[role="switch"]') as HTMLButtonElement;
	expect(toggle.getAttribute("aria-checked")).toBe("false");
	await act(async () => {
		toggle.dispatchEvent(new window.Event("click", { bubbles: true }));
	});
	expect(toggle.getAttribute("aria-checked")).toBe("true");
	expect(localStorage.setItem).toHaveBeenCalledWith("yonder.prefs", expect.stringContaining("group-test"));
});
it("surfaces unavailable history rather than leaving a loading placeholder", async () => {
	chat.history.mockRejectedValue(Object.assign(new Error("not_found"), { status: 404 }));
	await render();
	await click("查找聊天记录");
	expect(container.querySelector('[role="alert"]')?.textContent).toContain("尚未启用");
	expect(button("重试")).toBeDefined();
});
it("queries a trimmed keyword and one calendar day, then can clear the filter", async () => {
	await render();
	await click("查找聊天记录");
	await change('input[type="search"]', "  项目  ");
	await change('input[type="date"]', "2026-10-31");
	await act(async () => {
		container.querySelector("form")?.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
	});
	await flush();
	const range = historyDayRange("2026-10-31");
	expect(chat.history).toHaveBeenLastCalledWith(
		"group-test",
		expect.objectContaining({ q: "项目", ...range, limit: 40 }),
	);
	expect(range.to).toBe(new Date("2026-11-01T00:00:00").getTime());
	await click("清除");
	expect(chat.history).toHaveBeenLastCalledWith("group-test", expect.objectContaining({ q: "" }));
});
it("paginates by the oldest sequence and previews a result before opening its context", async () => {
	chat.history
		.mockResolvedValueOnce({ items: [message("new", 9)], hasMore: true })
		.mockResolvedValueOnce({ items: [message("old", 3)], hasMore: false });
	await render();
	await click("查找聊天记录");
	await click("更早的记录");
	expect(chat.history).toHaveBeenLastCalledWith("group-test", expect.objectContaining({ before: 9 }));
	const result = [...container.querySelectorAll("button[aria-label]")].find((el) =>
		el.textContent?.includes("项目记录 old"),
	);
	await act(async () => {
		result?.dispatchEvent(new window.Event("click", { bubbles: true }));
	});
	expect(container.querySelector("h1")?.textContent).toBe("消息预览");
	expect(select).not.toHaveBeenCalled();
	await click("查看上下文");
	expect(select).toHaveBeenCalledWith(expect.objectContaining({ id: "old", seq: 3 }));
	expect(close).toHaveBeenCalledOnce();
});
it("browses images inside history and returns from an image preview using the same header", async () => {
	chat.history.mockResolvedValue({
		items: [message("image", 5, { type: "image", url: "https://images.test/p.png", name: "项目照片" })],
		hasMore: false,
	});
	await render();
	await click("查找聊天记录");
	const tab = container.querySelector('[role="tab"][aria-selected="false"]');
	await act(async () => {
		tab?.dispatchEvent(new window.Event("click", { bubbles: true }));
	});
	await flush();
	expect(chat.history).toHaveBeenLastCalledWith("group-test", expect.objectContaining({ kind: "image" }));
	const result = container.querySelector("ul button");
	await act(async () => {
		result?.dispatchEvent(new window.Event("click", { bubbles: true }));
	});
	expect(container.querySelector("h1")?.textContent).toBe("图片预览");
	expect(container.querySelector("img")?.getAttribute("src")).toBe("https://images.test/p.png");
	await clickAria("返回查询结果");
	expect(container.querySelector("h1")?.textContent).toBe("聊天记录");
	expect(container.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("图片");
});

it("lets an ordinary member edit only their own group nickname and keeps the account name unchanged", async () => {
	const d = group();
	api.conversationDetail.mockResolvedValue(d);
	$session.set({ actor: { ...d.members[2] } });
	chat.setNickname.mockResolvedValue({ nickname: "设计搭子" });
	await render();
	await clickAria("编辑我在本群的昵称");
	expect(container.querySelector("h1")?.textContent).toBe("我在本群的昵称");
	await change("form input", "  设计搭子  ");
	await act(async () => {
		container.querySelector("form")?.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
	});
	await flush();
	expect(chat.setNickname).toHaveBeenCalledWith("group-test", "设计搭子");
	expect($session.get()?.actor.name).toBe("成员乙");
	expect(chat.update).not.toHaveBeenCalled();
	expect(container.querySelector("h1")?.textContent).toBe("聊天详情");
});
it("clears a nickname with null and keeps failed saves on the form", async () => {
	const d = group();
	d.selfNickname = "旧昵称";
	api.conversationDetail.mockResolvedValue(d);
	chat.setNickname.mockRejectedValue(Object.assign(new Error("not_found"), { status: 404 }));
	await render();
	await clickAria("编辑我在本群的昵称");
	await click("恢复账号名称");
	await act(async () => {
		container.querySelector("form")?.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
	});
	await flush();
	expect(chat.setNickname).toHaveBeenCalledWith("group-test", null);
	expect(container.querySelector('[role="alert"]')?.textContent).toContain("尚未启用");
	expect(container.querySelector("h1")?.textContent).toBe("我在本群的昵称");
});
it("counts nickname Unicode code points and preserves the original account identity in member labels", async () => {
	expect(validateGroupNickname("😀".repeat(32))).toBeUndefined();
	expect(validateGroupNickname("😀".repeat(33))).toContain("32");
	expect(validateGroupNickname(`昵称${String.fromCodePoint(10)}换行`)).toContain("控制字符");
	expect(groupMemberName({ name: "账号名", nickname: "  群昵称  " })).toBe("群昵称");
	const d = group();
	d.members[2].nickname = "群昵称";
	api.conversationDetail.mockResolvedValue(d);
	await render();
	const entry = [...container.querySelectorAll("a")].find((el) => el.textContent?.includes("群昵称"));
	expect(entry?.textContent).toContain("成员乙");
	expect(d.members[2].name).toBe("成员乙");
});
