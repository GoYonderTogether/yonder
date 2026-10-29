import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Composer } from "../src/pages/Chat";

const api = vi.hoisted(() => ({ send: vi.fn(), actors: vi.fn() }));
const toast = vi.hoisted(() => vi.fn());
vi.mock("../src/api", () => ({ api }));
vi.mock("../src/cache", () => ({ selectAccount: vi.fn() }));
vi.mock("../src/ui/Toast", () => ({ toast }));
vi.mock("../src/components/VerifySheet", () => ({ VerifySheet: () => null }));

let container: HTMLElement;
let root: Root;
const mount = async (offline: boolean, agentId?: string) => {
	const { document, window } = parseHTML("<html><body></body></html>");
	vi.stubGlobal("window", window);
	vi.stubGlobal("document", document);
	vi.stubGlobal("location", { search: "" });
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	container = document.createElement("div") as unknown as HTMLElement;
	document.body.appendChild(container as never);
	root = createRoot(container);
	await act(() =>
		root.render(
			<QueryClientProvider client={new QueryClient()}>
				<MemoryRouter>
					<Composer convId="c1" offline={offline} agentId={agentId} onSend={() => {}} />
				</MemoryRouter>
			</QueryClientProvider>,
		),
	);
};
afterEach(async () => {
	await act(() => root.unmount());
	vi.unstubAllGlobals();
	vi.resetAllMocks();
});

async function sendText(value: string) {
	const el = container.querySelector("textarea") as HTMLTextAreaElement;
	const key = Object.keys(el).find((k) => k.startsWith("__reactProps$"));
	const props = (el as unknown as Record<string, { onChange?(e: unknown): void }>)[key ?? ""];
	await act(async () => props?.onChange?.({ target: { value, style: {}, scrollHeight: 20 } }));
	const button = container.querySelector('button[aria-label="发送"]');
	await act(async () => button?.dispatchEvent(new window.Event("click", { bubbles: true })));
}

describe("给离线 Bot 发消息", () => {
	beforeEach(() => {
		api.send.mockResolvedValue({
			id: "m1",
			convId: "c1",
			seq: 1,
			senderId: "u1",
			content: { type: "text", text: "x" },
		});
	});
	it("发送成功后提示上线后送达", async () => {
		await mount(true);
		await sendText("你好");
		expect(toast).toHaveBeenCalledWith("Bot 离线，消息已保存，上线后送达");
	});
	it("页面缓存仍显示在线、发送时重取到离线，也提示（JV2-J07-R2-02）", async () => {
		api.actors.mockResolvedValue([{ id: "b1", kind: "agent", name: "Bot", online: false }]);
		await mount(false, "b1");
		await sendText("你好");
		expect(api.actors).toHaveBeenCalledWith(["b1"]);
		expect(toast).toHaveBeenCalledWith("Bot 离线，消息已保存，上线后送达");
	});
	it("重取到在线不提示", async () => {
		api.actors.mockResolvedValue([{ id: "b1", kind: "agent", name: "Bot", online: true }]);
		await mount(false, "b1");
		await sendText("你好");
		expect(toast).not.toHaveBeenCalled();
	});
	it("在线 Bot 不提示", async () => {
		await mount(false);
		await sendText("你好");
		expect(toast).not.toHaveBeenCalled();
	});
});
