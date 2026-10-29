import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Install } from "../../src/work/features/social/Install";

const createInvite = vi.hoisted(() => vi.fn());
vi.mock("../../src/work/api/social", () => ({ httpApi: { createInvite }, SocialError: class extends Error {} }));

let container: HTMLElement;
let root: Root;
beforeEach(async () => {
	const { window } = parseHTML("<html><body><div id='root'></div></body></html>");
	vi.stubGlobal("window", window);
	vi.stubGlobal("document", window.document);
	vi.stubGlobal("location", { origin: "https://example.com" });
	vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	container = window.document.getElementById("root") as unknown as HTMLElement;
	root = createRoot(container);
	createInvite.mockReset();
	await act(async () =>
		root.render(
			<QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>
				<Install />
			</QueryClientProvider>,
		),
	);
});
afterEach(async () => {
	await act(async () => root.unmount());
	vi.unstubAllGlobals();
});
const copy = async () => {
	await act(async () => {
		container.querySelector("button:not([role=tab])")?.dispatchEvent(new window.Event("click", { bubbles: true }));
	});
};

describe("Install", () => {
	it("renders an empty invite initially", () => {
		expect(container.textContent).toContain("__________");
	});
	it("renders loading while obtaining an invite", async () => {
		createInvite.mockReturnValue(new Promise(() => {}));
		await copy();
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 20));
		});
		expect(container.textContent).toContain("正在获取邀请码");
	});
	it("renders the returned invite", async () => {
		createInvite.mockResolvedValue({ code: "1234567890", expiresAt: "2099-01-01T00:00:00Z" });
		await copy();
		expect(container.textContent).toContain("1234567890");
		expect(navigator.clipboard.writeText).toHaveBeenCalledOnce();
	});
	it("renders an error when the API fails", async () => {
		createInvite.mockRejectedValue(new Error("failed"));
		await copy();
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 20));
		});
		expect(container.textContent).toContain("邀请码生成失败");
	});
});
