import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Login } from "../src/pages/Login";

const api = vi.hoisted(() => ({ sendCode: vi.fn(), verifyCode: vi.fn(), shareLinkStatus: vi.fn() }));
vi.mock("../src/api", () => ({ api }));
vi.mock("../src/cache", () => ({ selectAccount: vi.fn() }));

let container: HTMLElement;
let root: Root;
let client: QueryClient;
beforeEach(() => {
	const { document, window } = parseHTML("<html><body></body></html>");
	vi.stubGlobal("window", window);
	vi.stubGlobal("document", document);
	vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	container = document.createElement("div") as unknown as HTMLElement;
	document.body.appendChild(container as never);
	root = createRoot(container);
	client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(async () => {
	await act(() => root.unmount());
	vi.unstubAllGlobals();
	vi.resetAllMocks();
});

async function renderAt(search: string) {
	await act(() =>
		root.render(
			<QueryClientProvider client={client}>
				<MemoryRouter initialEntries={[`/login${search}`]}>
					<Login />
				</MemoryRouter>
			</QueryClientProvider>,
		),
	);
	await act(async () => {
		await new Promise((r) => setTimeout(r, 0));
	});
}

describe("Login share-link status", () => {
	it("shows the expired-link notice on open, before any code is sent", async () => {
		api.shareLinkStatus.mockResolvedValue({ state: "share_expired" });
		await renderAt("?share=tok123");
		expect(api.shareLinkStatus).toHaveBeenCalledWith("tok123");
		expect(api.sendCode).not.toHaveBeenCalled();
		expect(container.querySelector('[role="alert"]')?.textContent).toBe("这个分享链接已过期，请让分享者重新生成");
	});

	it("shows nothing for an active link or when there is no share param", async () => {
		api.shareLinkStatus.mockResolvedValue({ state: "active" });
		await renderAt("?share=tok123");
		expect(container.querySelector('[role="alert"]')).toBeNull();
		await renderAt("");
		expect(api.shareLinkStatus).toHaveBeenCalledTimes(1);
	});
});
