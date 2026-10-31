import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Actor } from "../src/api/types";
import { PasswordReset } from "../src/components/PasswordReset";
import { Login } from "../src/pages/Login";
import { $session } from "../src/store";

const api = vi.hoisted(() => ({ sendCode: vi.fn(), verifyCode: vi.fn(), shareLinkStatus: vi.fn() }));
const password = vi.hoisted(() => ({
	ensureRegistrationSupported: vi.fn(),
	passwordApi: { login: vi.fn(), register: vi.fn(), sendResetCode: vi.fn(), reset: vi.fn() },
}));
vi.mock("../src/api", () => ({ api }));
vi.mock("../src/api/password", () => password);
vi.mock("../src/cache", () => ({ selectAccount: vi.fn() }));
let container: HTMLElement, root: Root, client: QueryClient;
beforeEach(() => {
	const { document, window } = parseHTML("<html><body></body></html>");
	vi.stubGlobal("window", window);
	vi.stubGlobal("document", document);
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
	container = document.createElement("div") as unknown as HTMLElement;
	document.body.appendChild(container as never);
	root = createRoot(container);
	client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(async () => {
	await act(() => root.unmount());
	client.clear();
	$session.set(null);
	vi.unstubAllGlobals();
	vi.resetAllMocks();
});
async function render(ui: React.ReactNode, path = "/login") {
	await act(() =>
		root.render(
			<QueryClientProvider client={client}>
				<MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>
			</QueryClientProvider>,
		),
	);
}
function button(label: string) {
	const found = [...container.querySelectorAll("button")].find((el) => el.textContent === label);
	expect(found).toBeDefined();
	return found as HTMLButtonElement;
}
async function click(label: string) {
	await act(async () => {
		button(label).dispatchEvent(new window.Event("click", { bubbles: true }));
	});
}
async function type(selector: string, value: string) {
	const el = container.querySelector(selector) as HTMLElement;
	const key = Object.keys(el).find((k) => k.startsWith("__reactProps$"));
	const props = (el as unknown as Record<string, { onChange(e: unknown): void }>)[key ?? ""];
	await act(() => props.onChange({ target: { value } }));
}
const actor = {
	id: "self",
	name: "本人",
	kind: "human",
	phone: "13800138000",
	email: "self@example.com",
	code: "AB12CD",
} as Actor;
it("offers password login by a public account ID and a distinct verified registration form", async () => {
	await render(<Login />);
	expect(container.textContent).toContain("手机号 / 邮箱 / 账号 ID");
	expect(container.querySelector('input[type="password"]')).not.toBeNull();
	await click("注册新账号");
	expect(container.querySelectorAll('[type="password"]')).toHaveLength(2);
	expect([...container.querySelectorAll("label")].some((el) => el.textContent === "验证码")).toBe(true);
	expect(container.textContent).not.toContain("不设密码");
	expect(api.sendCode).not.toHaveBeenCalled();
});
it("checks registration support before sending any code on an old server", async () => {
	password.ensureRegistrationSupported.mockRejectedValue(Object.assign(new Error("not_found"), { status: 404 }));
	await render(<Login />, "/login?mode=register");
	await type('input[type="tel"]', "13800138000");
	await click("发送验证码");
	expect(password.ensureRegistrationSupported).toHaveBeenCalledOnce();
	expect(api.sendCode).not.toHaveBeenCalled();
	expect(container.textContent).toContain("尚未启用密码");
});
it("keeps registration fields and mode controls locked while its send is pending", async () => {
	password.ensureRegistrationSupported.mockResolvedValue(undefined);
	let finish!: (v: unknown) => void;
	api.sendCode.mockImplementation(
		() =>
			new Promise((resolve) => {
				finish = resolve;
			}),
	);
	await render(<Login />, "/login?mode=register");
	await type('input[type="tel"]', "13800138000");
	await click("发送验证码");
	expect(container.querySelector("form fieldset")?.hasAttribute("disabled")).toBe(true);
	expect(button("已有账号？登录").disabled).toBe(true);
	expect(button("密码登录").disabled).toBe(true);
	await act(async () => finish({ sent: true, retryAfter: 60 }));
	expect(button("已有账号？登录").disabled).toBe(false);
});
it("does not offer password reset without a verified bound contact", async () => {
	await render(<PasswordReset actor={{ id: "no-contact", name: "本人", kind: "human" } as Actor} />);
	expect(button("重置密码").disabled).toBe(true);
	expect(container.textContent).toContain("请先绑定并验证");
	expect(password.passwordApi.sendResetCode).not.toHaveBeenCalled();
});
it("uses the masked bound contact and locks cancel and channel selection during a send", async () => {
	let finish!: (v: unknown) => void;
	password.passwordApi.sendResetCode.mockImplementation(
		() =>
			new Promise((resolve) => {
				finish = resolve;
			}),
	);
	await render(<PasswordReset actor={actor} />);
	await click("重置密码");
	const target = container.querySelector('input[type="tel"]') as HTMLInputElement;
	expect(target.hasAttribute("readOnly")).toBe(true);
	expect(target.value).not.toBe(actor.phone);
	expect(container.textContent).toContain("账号 ID：AB12CD");
	expect(password.passwordApi.sendResetCode).not.toHaveBeenCalled();
	await click("发送验证码");
	expect(password.passwordApi.sendResetCode).toHaveBeenCalledWith("phone");
	expect(button("取消").disabled).toBe(true);
	expect(
		[...container.querySelectorAll('fieldset[aria-label="验证身份方式"] button')].every(
			(el) => (el as HTMLButtonElement).disabled,
		),
	).toBe(true);
	expect(container.querySelector("form fieldset")?.hasAttribute("disabled")).toBe(true);
	await act(async () => finish({ sent: true, retryAfter: 60 }));
	expect(button("取消").disabled).toBe(false);
});
it("unlocks reset after a successful reset so another attempt can be opened", async () => {
	const session = { actor };
	password.passwordApi.sendResetCode.mockResolvedValue({ sent: true, retryAfter: 60 });
	password.passwordApi.reset.mockResolvedValue(session);
	await render(<PasswordReset actor={actor} />);
	await click("重置密码");
	await click("发送验证码");
	await type('input[type="text"]', "123456");
	const fields = container.querySelectorAll('input[type="password"]');
	for (const input of fields) {
		const key = Object.keys(input).find((k) => k.startsWith("__reactProps$"));
		const props = (input as unknown as Record<string, { onChange(e: unknown): void }>)[key ?? ""];
		await act(() => props.onChange({ target: { value: "newpassword" } }));
	}
	const form = container.querySelector("form") as HTMLFormElement;
	await act(async () => {
		form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
	});
	expect(password.passwordApi.reset).toHaveBeenCalledWith("phone", "123456", "newpassword");
	expect($session.get()).toEqual(session);
	expect(container.textContent).toContain("密码已重置");
	expect(button("重置密码").disabled).toBe(false);
	await click("重置密码");
	expect(button("取消").disabled).toBe(false);
	expect(container.querySelector("form")).not.toBeNull();
});

it("shows existing-account registration guidance instead of claiming its password was set", async () => {
	password.ensureRegistrationSupported.mockResolvedValue(undefined);
	api.sendCode.mockResolvedValue({ sent: true, retryAfter: 60 });
	password.passwordApi.register.mockRejectedValue(new Error("account_exists"));
	await render(<Login />, "/login?mode=register");
	await type('input[type="tel"]', "13800138000");
	await click("发送验证码");
	await type('input[type="text"]', "123456");
	for (const input of container.querySelectorAll('input[type="password"]')) {
		const key = Object.keys(input).find((k) => k.startsWith("__reactProps$"));
		const props = (input as unknown as Record<string, { onChange(e: unknown): void }>)[key ?? ""];
		await act(() => props.onChange({ target: { value: "newpassword" } }));
	}
	const form = container.querySelector("form") as HTMLFormElement;
	await act(async () => {
		form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
	});
	expect(container.querySelector('[role="alert"]')?.textContent).toContain("账号已存在，请登录");
	expect($session.get()).toBeNull();
});
