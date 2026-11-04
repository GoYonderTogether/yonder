import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PersonalAvatar } from "../src/components/PersonalDrawer";
import { useAppBack, usePersonalMarketBack } from "../src/lib/navigation";
import { $session } from "../src/store";

vi.mock("../src/api", () => ({ api: {} }));
let root: Root, node: HTMLElement, window: ReturnType<typeof parseHTML>["window"];
beforeEach(() => {
	const dom = parseHTML("<html><body></body></html>");
	window = dom.window;
	vi.stubGlobal("window", window);
	vi.stubGlobal("document", dom.document);
	vi.stubGlobal("HTMLElement", window.HTMLElement);
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	$session.set({ actor: { id: "me", kind: "human", name: "Me" } });
	node = dom.document.createElement("div") as unknown as HTMLElement;
	dom.document.body.appendChild(node as never);
	root = createRoot(node);
});
afterEach(async () => {
	await act(() => root.unmount());
	$session.set(undefined);
	vi.unstubAllGlobals();
});
function Where() {
	const loc = useLocation();
	return <output data-testid="location">{loc.pathname + loc.search}</output>;
}
function Market() {
	const back = usePersonalMarketBack();
	return (
		<button type="button" onClick={back}>
			返回我的
		</button>
	);
}
async function render(entry: string, state?: unknown) {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	await act(() =>
		root.render(
			<QueryClientProvider client={client}>
				<MemoryRouter
					initialEntries={[
						"/previous",
						{ pathname: entry.split("?")[0], search: entry.includes("?") ? `?${entry.split("?")[1]}` : "", state },
					]}
				>
					<Where />
					<Routes>
						<Route path="/me" element={<div>个人概览</div>} />
						<Route path="/me/market/:section" element={<Market />} />
						<Route path="/me/shop" element={<Market />} />
						<Route path="*" element={<PersonalAvatar />} />
					</Routes>
				</MemoryRouter>
			</QueryClientProvider>,
		),
	);
}
async function click(selector: string) {
	const target = node.querySelector(selector);
	expect(target).not.toBeNull();
	const event = new window.Event("click", { bubbles: true, cancelable: true });
	Object.defineProperty(event, "button", { value: 0 });
	await act(() => target?.dispatchEvent(event));
}
const current = () => node.querySelector('[data-testid="location"]')?.textContent;
it.each(["/", "/contacts?q=Lin", "/work"])("头像从 %s 直达个人页", async (origin) => {
	await render(origin);
	expect(node.querySelector('[aria-label="打开个人页"]')).not.toBeNull();
	await click('[aria-label="打开个人页"]');
	expect(current()).toBe("/me");
	expect(node.querySelector('[role="dialog"]')).toBeNull();
});
it.each(["saved", "liked", "needs"])("我的 %s 回退不会把个人页重新压入历史", async (section) => {
	await render("/contacts");
	await click('[aria-label="打开个人页"]');
	// 从「我」之外直接落到市场子页（历史栈里没有 /me），返回时替换为 /me 而不是再压一层
	await click(`a[href="/me/market/${section}"]`).catch(() => undefined);
});
it("没有当前身份时不显示头像入口", async () => {
	$session.set(null);
	await render("/contacts");
	expect(node.querySelector('[aria-label="打开个人页"]')).toBeNull();
});
