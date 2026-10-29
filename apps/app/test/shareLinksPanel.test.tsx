import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ShareLinkList } from "../src/components/ShareLinks";

const api = vi.hoisted(() => ({
	createShareLink: vi.fn(),
	getShareLink: vi.fn(),
	revokeShareLink: vi.fn(),
}));
vi.mock("../src/api", () => ({ api }));

let container: HTMLElement;
let root: Root;
let client: QueryClient;
beforeEach(() => {
	const { document, window } = parseHTML("<html><body></body></html>");
	vi.stubGlobal("window", window);
	vi.stubGlobal("document", document);
	vi.stubGlobal("location", { origin: "https://yonder.example" });
	const store = new Map<string, string>();
	vi.stubGlobal("localStorage", {
		getItem: (k: string) => store.get(k) ?? null,
		setItem: (k: string, v: string) => void store.set(k, v),
	});
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	container = document.createElement("div") as unknown as HTMLElement;
	document.body.appendChild(container as never);
	root = createRoot(container);
	client = new QueryClient();
});
afterEach(async () => {
	await act(() => root.unmount());
	vi.unstubAllGlobals();
	vi.resetAllMocks();
});

async function render() {
	await act(() =>
		root.render(
			<QueryClientProvider client={client}>
				<ShareLinkList kind="group" targetId="g1" path="/g/tok" />
			</QueryClientProvider>,
		),
	);
}

/** linkedom 不支持 input 事件：直接调用 React 挂在节点上的 onChange prop（同 Login.test.tsx）。 */
async function type(input: HTMLInputElement, value: string) {
	const key = Object.keys(input).find((k) => k.startsWith("__reactProps$"));
	const props = (input as unknown as Record<string, { onChange?(e: { target: { value: string } }): void }>)[key ?? ""];
	if (!props?.onChange) throw new Error("input has no React onChange prop");
	await act(async () => props.onChange?.({ target: { value } }));
}

describe("ShareLinks panel", () => {
	it("creates a link with the chosen uses and expiry, then shows usage", async () => {
		api.createShareLink.mockResolvedValue({
			token: "tok123456789",
			kind: "group",
			targetId: "g1",
			maxUses: 2,
			usedCount: 0,
			expiresAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
			revokedAt: null,
			url: "",
		});
		api.getShareLink.mockResolvedValue({
			token: "tok123456789",
			kind: "group",
			targetId: "g1",
			maxUses: 2,
			usedCount: 1,
			expiresAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
			revokedAt: null,
			url: "",
		});
		await render();
		const inputs = [...container.querySelectorAll("input")] as HTMLInputElement[];
		const [usesInput, daysInput] = inputs;
		await act(async () => {
			await type(usesInput, "2");
			await type(daysInput, "3");
		});
		const form = container.querySelector('form[aria-label="新建分享链接"]') as HTMLFormElement;
		await act(async () => form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })));
		expect(api.createShareLink).toHaveBeenCalledTimes(1);
		const input = api.createShareLink.mock.calls[0][0];
		expect(input).toMatchObject({ kind: "group", targetId: "g1", maxUses: 2 });
		expect(typeof input.expiresAt).toBe("string");
	});

	it("rejects an out-of-range uses value without calling the API", async () => {
		await render();
		const usesInput = container.querySelectorAll("input")[0] as HTMLInputElement;
		await act(async () => {
			await type(usesInput, "5000");
		});
		const form = container.querySelector('form[aria-label="新建分享链接"]') as HTMLFormElement;
		await act(async () => form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })));
		expect(api.createShareLink).not.toHaveBeenCalled();
		expect(container.textContent).toContain("可用次数请填 1 到 1000 之间的整数");
	});
});
