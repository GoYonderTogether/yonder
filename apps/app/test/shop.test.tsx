import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { parseHTML } from "linkedom";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { IdentityDetail } from "../src/components/IdentityDetail";
import { type PublishPolicy, PublishPolicyFields } from "../src/components/market/PublishPolicyFields";
import { Shop } from "../src/pages/Shop";
import { $session } from "../src/store";

const api = vi.hoisted(() => ({
	marketCapabilities: vi.fn(),
	profile: vi.fn(),
	resolve: vi.fn(),
	marketListings: vi.fn(),
	marketListing: vi.fn(),
	deleteListing: vi.fn(),
	setListingPaused: vi.fn(),
}));
vi.mock("../src/api", () => ({ api }));
vi.mock("../src/ui/Toast", () => ({ toast: vi.fn() }));
vi.mock("radix-ui", async () => {
	const { createElement: h, Fragment } = await import("react");
	const box = (tag: string) => (p: { children?: ReactNode }) => h(tag, null, p.children);
	return {
		Dialog: {
			Root: (p: { open: boolean; children?: ReactNode }) => (p.open ? h(Fragment, null, p.children) : null),
			Portal: box("div"),
			Overlay: () => null,
			Content: box("section"),
			Title: box("h2"),
			Description: box("p"),
			Close: box("button"),
		},
	};
});
const actor = { id: "seller-id", kind: "human" as const, name: "卖家", code: "ABC123" };
const item = {
	id: "post-id",
	sellerId: actor.id,
	seller: actor.name,
	sellerRole: "个人",
	kind: "item",
	category: "数码好物",
	title: "自己的发布",
	description: "说明",
	location: "",
	delivery: "面交",
	image: "",
	price: 1,
	unit: "",
	tags: [],
	facts: [],
	missing: [],
	createdAt: 1,
	agent: false,
	metrics: { agentViews: 20, humanViews: 1, shortlists: 0, inquiries: 0 },
};
let root: Root, node: HTMLElement, window: ReturnType<typeof parseHTML>["window"];
beforeEach(() => {
	const dom = parseHTML("<html><body></body></html>");
	window = dom.window;
	vi.stubGlobal("window", window);
	vi.stubGlobal("document", dom.document);
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	const storage = new Map<string, string>();
	vi.stubGlobal("localStorage", {
		getItem: (key: string) => storage.get(key) ?? null,
		setItem: (key: string, value: string) => storage.set(key, value),
		removeItem: (key: string) => storage.delete(key),
	});
	node = dom.document.createElement("div") as unknown as HTMLElement;
	dom.document.body.appendChild(node as never);
	root = createRoot(node);
	api.marketCapabilities.mockResolvedValue({ listingPolicy: true, sellerShops: true });
	api.profile.mockResolvedValue({ actor, card: null, agents: [], owner: null, summary: null });
	api.resolve.mockResolvedValue({ id: actor.id, code: actor.code });
	api.marketListing.mockResolvedValue(null);
	api.marketListings.mockResolvedValue({ items: [] });
	$session.set(null);
});
afterEach(async () => {
	await act(() => root.unmount());
	$session.set(undefined);
	vi.resetAllMocks();
	vi.unstubAllGlobals();
});
async function flush() {
	for (let i = 0; i < 4; i++)
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 0));
		});
}
function CurrentPath() {
	const location = useLocation();
	return <output data-testid="shop-location">{location.pathname + location.search}</output>;
}
async function render(path: string) {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	await act(() =>
		root.render(
			<QueryClientProvider client={client}>
				<MemoryRouter initialEntries={[path]}>
					<CurrentPath />
					<Routes>
						<Route path="/shop/:accountId" element={<Shop />} />
						<Route path="/me/shop" element={<Shop />} />
						<Route path="/login" element={<p>需要登录</p>} />
					</Routes>
				</MemoryRouter>
			</QueryClientProvider>,
		),
	);
	await flush();
	return client;
}
async function click(text: string) {
	const button = [...node.querySelectorAll("button")].find((button) => button.textContent?.trim() === text);
	expect(button).toBeTruthy();
	await act(() => button?.click());
	await flush();
}
it("resolves the seller and paginates that seller on the server instead of filtering a mixed first page", async () => {
	api.marketListings
		.mockResolvedValueOnce({ items: [{ ...item, mine: false }], nextCursor: "cursor-2" })
		.mockResolvedValueOnce({ items: [{ ...item, id: "post-2", title: "下一页发布", mine: false }] });
	await render("/shop/ABC123");
	expect(api.resolve).toHaveBeenCalledWith("actor", "ABC123");
	expect(api.marketListings).toHaveBeenCalledWith({ sellerId: actor.id, cursor: undefined });
	expect(node.textContent).toContain("自己的发布");
	expect(node.querySelector("summary")).toBeNull();
	expect(node.textContent).not.toContain("在售已隐藏已到期");
	await click("加载更多");
	expect(api.marketListings).toHaveBeenLastCalledWith({ sellerId: actor.id, cursor: "cursor-2" });
	expect(node.textContent).toContain("下一页发布");
});
it("owner tabs request the appropriate server status and deletion remains pending on failure", async () => {
	$session.set({ actor });
	api.marketListings.mockImplementation(async ({ status }: { status: string }) => ({
		items: status === "active" ? [{ ...item, mine: true }] : [],
	}));
	api.deleteListing.mockRejectedValueOnce(new Error("forbidden")).mockResolvedValueOnce(undefined);
	await render("/me/shop");
	expect(api.marketListings).toHaveBeenCalledWith({ mine: true, status: "active", cursor: undefined });
	await click("删除");
	expect(api.deleteListing).not.toHaveBeenCalled();
	await click("确认删除");
	expect(node.textContent).toContain("你没有操作此发布的权限");
	expect(node.textContent).toContain("确认删除");
	api.marketListings.mockResolvedValue({ items: [] });
	await click("确认删除");
	expect(api.deleteListing).toHaveBeenLastCalledWith(item.id);
	expect(node.textContent).not.toContain("确认删除");
	await click("已隐藏");
	expect(api.marketListings).toHaveBeenLastCalledWith({ mine: true, status: "paused", cursor: undefined });
});
it("a listing load error is not presented as an empty shop", async () => {
	api.marketListings.mockRejectedValue(new Error("offline"));
	await render("/shop/seller-id");
	expect(node.textContent).toContain("发布加载失败");
	expect(node.textContent).not.toContain("暂时没有可浏览的发布");
	expect(node.querySelectorAll("button").length).toBeGreaterThan(0);
});
it("anonymous accounts must log in before managing a shop", async () => {
	$session.set({ actor: { ...actor, anonymous: true } });
	await render("/me/shop");
	expect(node.textContent).toContain("需要登录");
	expect(api.marketListings).not.toHaveBeenCalled();
});
it("shop visibility hides only the profile entry and humans no longer render visitor greetings", () => {
	const card = {
		id: "card",
		code: "CARD00",
		markdown: "旧开场白",
		tagline: "签名",
		summary: null,
		face: { theme: "mist" as const, visibility: { signature: true, code: true, greeting: true, shop: false } },
	};
	let html = renderToStaticMarkup(
		<MemoryRouter>
			<IdentityDetail actor={actor} card={card} />
		</MemoryRouter>,
	);
	expect(html).not.toContain('href="/shop/');
	expect(html).not.toContain("旧开场白");
	html = renderToStaticMarkup(
		<MemoryRouter>
			<IdentityDetail shopAvailable actor={actor} card={{ ...card, face: { theme: "mist" } }} />
		</MemoryRouter>,
	);
	expect(html).toContain('href="/shop/ABC123"');
});
it("asks for geolocation only on explicit action and keeps denied permission optional", async () => {
	const getCurrentPosition = vi.fn().mockImplementation((_success, fail) => fail({ code: 1 }));
	vi.stubGlobal("navigator", { geolocation: { getCurrentPosition } });
	const value: PublishPolicy = { location: "", coordinates: null, visibility: "public", duration: "forever" };
	const onError = vi.fn(),
		onChange = vi.fn(),
		onBusy = vi.fn();
	await act(() =>
		root.render(
			<PublishPolicyFields
				policyAvailable
				value={value}
				editing={false}
				disabled={false}
				onChange={onChange}
				onError={onError}
				onBusy={onBusy}
			/>,
		),
	);
	expect(getCurrentPosition).not.toHaveBeenCalled();
	await click("附上当前位置");
	expect(getCurrentPosition).toHaveBeenCalledOnce();
	expect(onError).toHaveBeenCalledWith(expect.stringContaining("未获定位权限"));
	expect(onChange).not.toHaveBeenCalled();
	expect(onBusy).toHaveBeenLastCalledWith(false);
});

it("canonicalizes the legacy expiry URL to hidden and keeps expired posts visible with renewal", async () => {
	$session.set({ actor });
	api.marketListings.mockResolvedValue({
		items: [
			{ ...item, mine: true, paused: false, expiresAt: 1 },
			{ ...item, id: "hidden-expired", title: "隐藏后到期的发布", mine: true, paused: true, expiresAt: 1 },
		],
	});
	await render("/me/shop?status=expired&source=legacy");
	expect(node.querySelector('[data-testid="shop-location"]')?.textContent).toBe("/me/shop?status=paused&source=legacy");
	expect(api.marketListings).toHaveBeenLastCalledWith({ mine: true, status: "paused", cursor: undefined });
	expect(api.marketListings.mock.calls.every(([query]) => query.status !== "expired")).toBe(true);
	expect([...node.querySelectorAll(".mk-personal-tabs button")].map((button) => button.textContent)).toEqual([
		"在售",
		"已隐藏",
	]);
	expect(node.textContent).toContain("自己的发布");
	expect(node.textContent).toContain("隐藏后到期的发布");
	expect(node.textContent).toContain("已到期");
	expect(node.textContent).not.toContain("没有隐藏的发布");
	await click("续期");
	expect(node.querySelector('[data-testid="shop-location"]')?.textContent).toContain("panel=publish");
	expect(node.querySelector('[data-testid="shop-location"]')?.textContent).toContain("edit=post-id");
	expect(api.setListingPaused).not.toHaveBeenCalled();
});

it("uses only legacy mine pagination and does not confuse an empty loaded tab with the complete shop", async () => {
	$session.set({ actor });
	api.marketCapabilities.mockResolvedValue({ listingPolicy: false, sellerShops: false });
	api.marketListings.mockImplementation(async ({ cursor }: { cursor?: string }) =>
		cursor
			? { items: [{ ...item, id: "hidden", title: "隐藏的发布", mine: true, paused: true }] }
			: { items: [{ ...item, mine: true }], nextCursor: "legacy-2" },
	);
	await render("/me/shop?status=paused");
	expect(api.marketListings).toHaveBeenCalledWith({ mine: true, cursor: undefined });
	expect(node.textContent).toContain("已加载的发布中暂无此类内容，可继续加载");
	expect(node.textContent).not.toContain("没有隐藏的发布");
	await click("加载更多");
	expect(api.marketListings).toHaveBeenLastCalledWith({ mine: true, cursor: "legacy-2" });
	expect(node.textContent).toContain("隐藏的发布");
	expect([...node.querySelectorAll("button")].some((button) => button.textContent?.trim() === "删除")).toBe(false);
	api.setListingPaused.mockResolvedValue({ ...item, paused: false });
	await click("重新上架");
	expect(api.setListingPaused).toHaveBeenCalledWith("hidden", false);
});
it("does not query a mixed feed or open a listing overlay when legacy public shops are unavailable", async () => {
	api.marketCapabilities.mockResolvedValue({ listingPolicy: false, sellerShops: false });
	await render("/shop/seller-id?panel=detail&item=post-id");
	expect(node.textContent).toContain("小店浏览暂未开放");
	expect(api.marketListings).not.toHaveBeenCalled();
	expect(api.marketListing).not.toHaveBeenCalled();
	expect(node.textContent).not.toContain("正在加载发布");
});
it("waits for capability confirmation and treats a capability network error as a retryable error", async () => {
	$session.set({ actor });
	api.marketCapabilities.mockRejectedValue(new Error("offline"));
	await render("/me/shop");
	expect(node.textContent).toContain("无法确认小店服务");
	expect(api.marketListings).not.toHaveBeenCalled();
	const publish = [...node.querySelectorAll("button")].find((button) => button.textContent?.trim() === "发布");
	expect(publish?.disabled).toBe(true);
});
