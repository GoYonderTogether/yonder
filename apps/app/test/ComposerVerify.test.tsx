import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Composer } from "../src/pages/Chat";
import { $session } from "../src/store";

const api = vi.hoisted(() => ({ send: vi.fn() }));
const sheet = vi.hoisted(() => ({ props: undefined as undefined | { open: boolean; onSuccess(s: unknown): void } }));
vi.mock("../src/api", () => ({ api }));
vi.mock("../src/cache", () => ({ selectAccount: vi.fn() }));
// 弹窗本体（Radix Dialog）在 linkedom 里不渲染；这里只验证 Composer 何时打开它、成功后做什么。
vi.mock("../src/components/VerifySheet", () => ({
	VerifySheet: (props: { open: boolean; onSuccess(s: unknown): void }) => {
		sheet.props = props;
		return null;
	},
}));

let container: HTMLElement;
let root: Root;
beforeEach(async () => {
	const { document, window } = parseHTML("<html><body></body></html>");
	vi.stubGlobal("window", window);
	vi.stubGlobal("document", document);
	vi.stubGlobal("location", { search: "?share=st-1" });
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	container = document.createElement("div") as unknown as HTMLElement;
	document.body.appendChild(container as never);
	root = createRoot(container);
	await act(() =>
		root.render(
			<QueryClientProvider client={new QueryClient()}>
				<MemoryRouter>
					<Composer convId="c1" offline={false} onSend={() => {}} />
				</MemoryRouter>
			</QueryClientProvider>,
		),
	);
});
afterEach(async () => {
	await act(() => root.unmount());
	vi.unstubAllGlobals();
	vi.resetAllMocks();
	sheet.props = undefined;
});

async function type(value: string) {
	const el = container.querySelector("textarea") as HTMLTextAreaElement;
	const key = Object.keys(el).find((k) => k.startsWith("__reactProps$"));
	const props = (el as unknown as Record<string, { onChange?(e: unknown): void }>)[key ?? ""];
	await act(async () => props?.onChange?.({ target: { value, style: {}, scrollHeight: 20 } }));
}
async function send() {
	const el = container.querySelector('button[aria-label="发送"]');
	await act(async () => el?.dispatchEvent(new window.Event("click", { bubbles: true })));
}

describe("Composer 访客额度", () => {
	it("opens the login sheet on verify_required and resends the held text after verifying", async () => {
		api.send.mockRejectedValueOnce({ status: 403, code: "verify_required" });
		await type("你好");
		await send();
		expect(sheet.props?.open).toBe(true);
		expect(api.send).toHaveBeenCalledTimes(1);

		const session = { actor: { id: "u1", name: "我", kind: "human" } };
		api.send.mockResolvedValue({
			id: "m2",
			convId: "c1",
			seq: 1,
			senderId: "u1",
			content: { type: "text", text: "x" },
		});
		await act(async () => sheet.props?.onSuccess(session));
		expect($session.get()).toEqual(session);
		expect(api.send).toHaveBeenLastCalledWith("c1", { type: "markdown", text: "你好" });
	});

	it("keeps ordinary send failures out of the login sheet", async () => {
		api.send.mockRejectedValue(new Error("网络错误"));
		await type("你好");
		await send();
		expect(sheet.props?.open).toBe(false);
	});
});
