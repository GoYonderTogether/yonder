import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { convRowMenu } from "../src/lib/convMenu";
import { ChatShell } from "../src/pages/Chat";
import { $session } from "../src/store";
import { setLevel, togglePin } from "../src/work/lib/prefs";

const api = vi.hoisted(() => ({
	conversations: vi.fn(),
	actors: vi.fn(),
	contacts: vi.fn(),
	subscribe: vi.fn(() => () => {}),
	openDm: vi.fn(),
	ensureDefaultBot: vi.fn(),
	markRead: vi.fn(async () => {}),
}));
vi.mock("../src/api", () => ({ api }));

describe("会话行菜单", () => {
	it("置顶、免打扰三档、标为已读，当前档位带选中标记", () => {
		const pin = vi.fn();
		const set = vi.fn();
		const read = vi.fn();
		const items = convRowMenu({ pinned: false, level: "mentions", pin, setLevel: set, markRead: read });
		expect(items.map((i) => i.label)).toEqual([
			"置顶",
			"免打扰：关闭",
			"免打扰：仅提问与审批",
			"免打扰：静音",
			"标为已读",
		]);
		expect(items.filter((i) => i.checked).map((i) => i.key)).toEqual(["mentions"]);
		items[0]?.onSelect();
		expect(pin).toHaveBeenCalledOnce();
		items[3]?.onSelect();
		expect(set).toHaveBeenCalledWith("mute");
		items[4]?.onSelect();
		expect(read).toHaveBeenCalledOnce();
	});

	it("已置顶时菜单项变成取消置顶", () => {
		const items = convRowMenu({
			pinned: true,
			level: "all",
			pin: () => {},
			setLevel: () => {},
			markRead: () => {},
		});
		expect(items[0]?.label).toBe("取消置顶");
	});
});

let container: HTMLElement;
let root: Root;

beforeEach(() => {
	const { document, window } = parseHTML("<html><body></body></html>");
	vi.stubGlobal("window", window);
	vi.stubGlobal("document", document);
	vi.stubGlobal("location", { href: "http://localhost:5180/", origin: "http://localhost:5180" });
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
	const values = new Map<string, string>();
	vi.stubGlobal("localStorage", {
		getItem: (k: string) => values.get(k) ?? null,
		setItem: (k: string, v: string) => values.set(k, v),
	});
	container = document.createElement("div") as unknown as HTMLElement;
	document.body.appendChild(container as never);
	root = createRoot(container);
	$session.set({ actor: { id: "me", kind: "human", name: "我" } });
	api.actors.mockResolvedValue([]);
	api.subscribe.mockReturnValue(() => {});
	api.contacts.mockResolvedValue([]);
	api.conversations.mockResolvedValue([
		{
			id: "conv1",
			code: "ABC123",
			kind: "dm",
			title: "小歪",
			memberIds: ["me", "bot1"],
			unread: 2,
			last: {
				id: "m7",
				convId: "conv1",
				seq: 7,
				senderId: "bot1",
				content: { type: "text", text: "在吗" },
				createdAt: 1,
			},
		},
	]);
});

afterEach(async () => {
	await act(() => root.unmount());
	$session.set(undefined);
	vi.unstubAllGlobals();
	vi.resetAllMocks();
});

async function render() {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	await act(async () =>
		root.render(
			<QueryClientProvider client={client}>
				<MemoryRouter initialEntries={["/"]}>
					<ChatShell />
				</MemoryRouter>
			</QueryClientProvider>,
		),
	);
	await act(async () => {
		await new Promise((r) => setTimeout(r, 20));
	});
}

describe("会话行的状态标记", () => {
	it("静音的会话显示免打扰图标，置顶的显示置顶标记", async () => {
		await render();
		expect(container.querySelector('[aria-label="免打扰"]')).toBeNull();
		await act(async () => {
			setLevel("conv1", "mute");
			togglePin("conv1");
		});
		await act(async () => {
			await new Promise((r) => setTimeout(r, 10));
		});
		expect(container.querySelector('[aria-label="免打扰"]')).toBeTruthy();
		expect(container.querySelector('[aria-label="已置顶"]')).toBeTruthy();
	});
});
