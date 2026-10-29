import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";
import { $session } from "../src/store";
import { Login } from "../src/pages/Login";

const api = vi.hoisted(() => ({ sendCode: vi.fn(), verifyCode: vi.fn() }));
vi.mock("../src/api", () => ({ api }));
vi.mock("../src/cache", () => ({ selectAccount: vi.fn() }));

let container: HTMLElement;
let root: Root;
let client: QueryClient;
beforeEach(async () => {
	const { document, window } = parseHTML("<html><body></body></html>");
	vi.stubGlobal("window", window);
	vi.stubGlobal("document", document);
	vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	container = document.createElement("div") as unknown as HTMLElement;
	document.body.appendChild(container as never);
	root = createRoot(container);
	client = new QueryClient();
	await act(() =>
		root.render(
			<QueryClientProvider client={client}>
				<MemoryRouter>
					<Login />
				</MemoryRouter>
			</QueryClientProvider>,
		),
	);
});
afterEach(async () => {
	await act(() => root.unmount());
	vi.unstubAllGlobals();
	vi.resetAllMocks();
});

function field(label: string): HTMLInputElement {
	const match = [...container.querySelectorAll("label")].find((el) => el.textContent === label);
	return match?.parentElement?.querySelector("input") as HTMLInputElement;
}
function button(text: string): HTMLButtonElement | undefined {
	return [...container.querySelectorAll("button")].find((el) => el.textContent?.includes(text));
}

/** 走 React 挂在节点上的 onChange prop 输入：linkedom 不支持 input 事件探测，
 * React 会走 polyfill 而不发 onChange，直接调 props 最不依赖 DOM 实现。 */
async function type(input: HTMLInputElement, value: string) {
	const key = Object.keys(input).find((k) => k.startsWith("__reactProps$"));
	const props = (input as unknown as Record<string, { onChange?(e: { target: { value: string } }): void }>)[key ?? ""];
	if (!props?.onChange) throw new Error("input has no React onChange prop");
	await act(async () => {
		props.onChange?.({ target: { value } });
	});
}

async function submit() {
	await act(async () => {
		container.querySelector("form")?.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
	});
}

describe("Login 验证码登录", () => {
	it("renders phone and email tabs and no password field", () => {
		expect(container.textContent).toContain("手机号");
		expect(container.textContent).toContain("邮箱");
		expect(container.textContent).toContain("登录或注册");
		expect(container.querySelector('input[type="password"]')).toBeNull();
		// 只有目标 + 验证码两个输入框，没有密码框（文案里可以提“不需要密码”，但不能有密码输入）。
		expect(container.querySelectorAll("input")).toHaveLength(2);
		expect([...container.querySelectorAll("label")].some((el) => el.textContent === "密码")).toBe(false);
	});

	it("sends a code for a valid phone and shows the countdown", async () => {
		api.sendCode.mockResolvedValue({ sent: true, retryAfter: 60 });
		await type(field("手机号"), "13800001234");
		await act(async () => button("发送验证码")?.dispatchEvent(new window.Event("click", { bubbles: true })));
		expect(api.sendCode).toHaveBeenCalledWith({ kind: "phone", target: "13800001234" });
		expect(container.textContent).toContain("验证码已发送");
		expect(container.textContent).toContain("60 秒后重新发送");
		expect(button("60 秒后重新发送")?.disabled).toBe(true);
	});

	it("rejects a malformed phone before calling the server", async () => {
		await type(field("手机号"), "12345");
		await act(async () => button("发送验证码")?.dispatchEvent(new window.Event("click", { bubbles: true })));
		expect(api.sendCode).not.toHaveBeenCalled();
		expect(container.textContent).toContain("请输入 11 位手机号");
	});

	it("switches to email and normalizes the address", async () => {
		api.sendCode.mockResolvedValue({ sent: true, retryAfter: 60 });
		await act(async () =>
			[...container.querySelectorAll('[role="tab"]')]
				.find((el) => el.textContent === "邮箱")
				?.dispatchEvent(new window.Event("click", { bubbles: true })),
		);
		await type(field("邮箱"), "  Alice@Example.COM ");
		await act(async () => button("发送验证码")?.dispatchEvent(new window.Event("click", { bubbles: true })));
		expect(api.sendCode).toHaveBeenCalledWith({ kind: "email", target: "alice@example.com" });
	});

	it("logs in with the code, stores the session and navigates", async () => {
		const session = { actor: { id: "a", name: "A", kind: "human" } };
		api.sendCode.mockResolvedValue({ sent: true, retryAfter: 60 });
		api.verifyCode.mockResolvedValue(session);
		await type(field("手机号"), "13800001234");
		await act(async () => button("发送验证码")?.dispatchEvent(new window.Event("click", { bubbles: true })));
		await type(field("验证码"), "123456");
		await submit();
		expect(api.verifyCode).toHaveBeenCalledWith({ kind: "phone", target: "13800001234", code: "123456" });
		expect($session.get()).toEqual(session);
	});

	it("maps invalid_code and locked errors to readable text", async () => {
		api.sendCode.mockResolvedValue({ sent: true, retryAfter: 60 });
		api.verifyCode.mockRejectedValueOnce({ status: 401, code: "invalid_code" });
		await type(field("手机号"), "13800001234");
		await act(async () => button("发送验证码")?.dispatchEvent(new window.Event("click", { bubbles: true })));
		await type(field("验证码"), "000000");
		await submit();
		expect(container.querySelector('[role="alert"]')?.textContent).toBe("验证码不正确，请重新输入");
		api.verifyCode.mockRejectedValueOnce({ status: 429, code: "locked" });
		await submit();
		expect(container.querySelector('[role="alert"]')?.textContent).toBe("尝试次数过多，请稍后再试");
	});
});
