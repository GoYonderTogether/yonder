import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SocialChat } from "../../src/features/social/SocialChat";

const api = vi.hoisted(() => ({
	resolve: vi.fn(),
	conversationDetail: vi.fn(),
	messages: vi.fn(),
	session: vi.fn(),
	markRead: vi.fn(),
	send: vi.fn(),
	sendCode: vi.fn(),
	verifyCode: vi.fn(),
}));
vi.mock("../../src/api/social", () => ({ httpApi: api }));

let container: HTMLElement;
let root: Root;
let client: QueryClient;

beforeEach(async () => {
	const { document, window } = parseHTML("<html><body></body></html>");
	// linkedom 没有实现 <dialog> 的 showModal/close；控件本身不在这条测试的断言范围内。
	const proto = window.HTMLDialogElement?.prototype ?? window.HTMLElement.prototype;
	Object.defineProperty(proto, "showModal", {
		configurable: true,
		value(this: { open: boolean }) {
			this.open = true;
		},
	});
	Object.defineProperty(proto, "close", {
		configurable: true,
		value(this: { open: boolean }) {
			this.open = false;
		},
	});
	Object.defineProperty(proto, "scrollIntoView", { configurable: true, value() {} });
	vi.stubGlobal("window", window);
	vi.stubGlobal("document", document);
	vi.stubGlobal("location", { search: "?share=st-1", hash: "#/c/chat", origin: "https://card.example" });
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	container = document.createElement("div") as unknown as HTMLElement;
	document.body.appendChild(container as never);
	root = createRoot(container);
	client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	api.resolve.mockResolvedValue({ id: "c1", code: "chat" });
	api.conversationDetail.mockResolvedValue({
		id: "c1",
		kind: "dm",
		title: "小伙伴",
		members: [{ id: "a", name: "A", kind: "human" }],
	});
	api.messages.mockResolvedValue([]);
	api.session.mockResolvedValue({ actor: { id: "a", name: "A", kind: "human", anonymous: true } });
	api.markRead.mockResolvedValue(undefined);
	await act(() =>
		root.render(
			<QueryClientProvider client={client}>
				<SocialChat id="chat" />
			</QueryClientProvider>,
		),
	);
	await vi.waitFor(() => expect(container.querySelector("textarea")).not.toBeNull());
});
afterEach(async () => {
	await act(() => root.unmount());
	vi.unstubAllGlobals();
	vi.resetAllMocks();
});

function textarea(): HTMLTextAreaElement {
	return container.querySelector("textarea") as HTMLTextAreaElement;
}

function button(label: string): HTMLButtonElement | undefined {
	return [...container.querySelectorAll("button")].find((el) => el.textContent?.includes(label));
}

async function type(value: string) {
	const el = textarea();
	const key = Object.keys(el).find((k) => k.startsWith("__reactProps$"));
	const props = (el as unknown as Record<string, { onChange?(e: unknown): void }>)[key ?? ""];
	const event = { target: { value, style: {}, scrollHeight: 20 } };
	await act(async () => props?.onChange?.(event));
}

/** 发送按钮只有图标，靠 aria-label 找。 */
async function send() {
	const el = container.querySelector('button[aria-label="发送"]') as HTMLButtonElement | null;
	await act(async () => el?.dispatchEvent(new window.Event("click", { bubbles: true })));
}

describe("SocialChat 访客额度", () => {
	it("opens the login sheet on verify_required and resends after verifying", async () => {
		api.send.mockRejectedValueOnce({ status: 403, code: "verify_required" });
		await type("你好");
		await send();
		// 不当普通发送失败处理，而是弹登录窗。
		expect(container.textContent).toContain("登录后继续聊天");
		expect(container.textContent).toContain("访客可以免费聊几句");
		expect(container.querySelector('[role="alert"]')).toBeNull();

		api.sendCode.mockResolvedValue({ sent: true, retryAfter: 60 });
		const phone = [...container.querySelectorAll("label")].find((el) => el.textContent === "手机号");
		const input = phone?.parentElement?.querySelector("input") as HTMLInputElement;
		const key = Object.keys(input).find((k) => k.startsWith("__reactProps$"));
		await act(async () => {
			(input as unknown as Record<string, { onChange(e: unknown): void }>)[key ?? ""].onChange({
				target: { value: "13800001234" },
			});
		});
		await act(async () => button("发送验证码")?.dispatchEvent(new window.Event("click", { bubbles: true })));
		expect(api.sendCode).toHaveBeenCalledWith({ kind: "phone", target: "13800001234", shareToken: "st-1" });

		const code = [...container.querySelectorAll("label")].find((el) => el.textContent === "验证码");
		const codeInput = code?.parentElement?.querySelector("input") as HTMLInputElement;
		const codeKey = Object.keys(codeInput).find((k) => k.startsWith("__reactProps$"));
		await act(async () => {
			(codeInput as unknown as Record<string, { onChange(e: unknown): void }>)[codeKey ?? ""].onChange({
				target: { value: "123456" },
			});
		});

		const session = { actor: { id: "u1", name: "我", kind: "human" } };
		api.verifyCode.mockResolvedValue(session);
		api.send.mockResolvedValue({
			id: "m2",
			convId: "c1",
			seq: 1,
			senderId: "u1",
			content: { type: "text", text: "你好" },
		});
		await act(async () =>
			[...container.querySelectorAll("form")]
				.at(-1)
				?.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true })),
		);
		expect(api.verifyCode).toHaveBeenCalledWith({
			kind: "phone",
			target: "13800001234",
			code: "123456",
			shareToken: "st-1",
		});
		expect(client.getQueryData(["social-session"])).toEqual(session);
		// 验证成功关窗，待发内容原样重发。
		expect(container.textContent).not.toContain("登录后继续聊天");
		expect(api.send).toHaveBeenLastCalledWith("c1", { type: "markdown", text: "你好" });
	});

	it("keeps ordinary send failures as an inline error", async () => {
		api.send.mockRejectedValue(new Error("网络错误"));
		await type("你好");
		await send();
		expect(container.querySelector('[role="alert"]')?.textContent).toBe("网络错误");
		expect(container.textContent).not.toContain("登录后继续聊天");
	});
});
