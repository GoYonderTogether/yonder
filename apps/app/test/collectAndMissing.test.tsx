import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { $session } from "../src/store";

const CARD = "2316f71f-5994-47b3-8661-125ec05e67c5";
const api = vi.hoisted(() => ({
	card: vi.fn(),
	profile: vi.fn(),
	cards: vi.fn(),
	collectCard: vi.fn(),
	resolve: vi.fn(),
}));
vi.mock("../src/api", () => ({ api }));
vi.mock("../src/ui/Toast", () => ({ toast: vi.fn() }));
vi.mock("../src/components/IdentityQr", () => ({ IdentityQr: () => null }));

const { PublicIdentity } = await import("../src/pages/CardPage");
const { Conversation } = await import("../src/pages/Chat");

let container: HTMLElement;
let root: Root;
beforeEach(() => {
	const { document, window } = parseHTML("<html><body></body></html>");
	vi.stubGlobal("window", window);
	vi.stubGlobal("document", document);
	vi.stubGlobal("location", { href: "http://localhost/", origin: "http://localhost", pathname: "/" });
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	container = document.createElement("div") as unknown as HTMLElement;
	document.body.appendChild(container as never);
	root = createRoot(container);
	const owner = { id: "agent-1", kind: "agent" as const, name: "E2E Bot", ownerId: "human-1", public: true };
	api.card.mockResolvedValue({
		id: CARD,
		code: "3W0LX3",
		ownerId: owner.id,
		status: "published",
		mine: false,
		title: "名片",
	});
	api.profile.mockResolvedValue({ actor: owner, summary: null, card: null, agents: [], owner: null });
	api.cards.mockResolvedValue([]);
	api.collectCard.mockResolvedValue(undefined);
	$session.set({ actor: { id: "visitor", kind: "human", name: "访客" } });
});
afterEach(async () => {
	await act(() => root.unmount());
	$session.set(undefined);
	vi.unstubAllGlobals();
	vi.clearAllMocks();
});

const settle = () => act(async () => new Promise((r) => setTimeout(r, 30)));
const button = (label: string) =>
	[...container.querySelectorAll("button")].find((b) => b.textContent === label) as HTMLButtonElement | undefined;

describe("JV2-J12-01 名片页收藏", () => {
	it("已登录访客能看到收藏按钮，用名片 UUID 调 collect，之后显示已收藏", async () => {
		api.resolve.mockResolvedValue({ id: CARD, code: "3W0LX3" });
		await act(async () =>
			root.render(
				<QueryClientProvider client={new QueryClient()}>
					<MemoryRouter>
						<PublicIdentity cardId="3W0LX3" />
					</MemoryRouter>
				</QueryClientProvider>,
			),
		);
		await settle();
		const collect = button("收藏");
		expect(collect).toBeDefined();
		api.cards.mockResolvedValue([{ id: CARD, mine: false, ownerId: "agent-1" }]);
		await act(async () => collect!.click());
		await settle();
		expect(api.collectCard).toHaveBeenCalledWith(CARD, "link");
		expect(button("已收藏")?.disabled).toBe(true);
	});

	it("匿名访客不显示收藏按钮", async () => {
		$session.set({ actor: { id: "anon", kind: "human", name: "访客", anonymous: true } });
		await act(async () =>
			root.render(
				<QueryClientProvider client={new QueryClient()}>
					<MemoryRouter>
						<PublicIdentity cardId={CARD} />
					</MemoryRouter>
				</QueryClientProvider>,
			),
		);
		await settle();
		expect(button("和 TA 聊天")).toBeDefined();
		expect(button("收藏")).toBeUndefined();
	});
});

describe("JV2-J13-04 /c/not-exist", () => {
	it("显示会话不存在和返回入口，不查接口", async () => {
		await act(async () =>
			root.render(
				<QueryClientProvider client={new QueryClient()}>
					<MemoryRouter initialEntries={["/c/not-exist"]}>
						<Routes>
							<Route path="/c/:id" element={<Conversation />} />
						</Routes>
					</MemoryRouter>
				</QueryClientProvider>,
			),
		);
		await settle();
		expect(container.textContent).toContain("会话不存在");
		expect(container.querySelector('a[href="/"]')?.textContent).toBe("回到消息");
		expect(api.resolve).not.toHaveBeenCalled();
	});
});
