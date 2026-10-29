import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountSecurity } from "../src/components/AccountSecurity";

const api = vi.hoisted(() => ({ sendBindCode: vi.fn(), confirmBindCode: vi.fn() }));
vi.mock("../src/api", () => ({ api }));

let container: HTMLElement;
let root: Root;
const signedOut = vi.fn();

beforeEach(async () => {
	const { document, window } = parseHTML("<html><body></body></html>");
	vi.stubGlobal("window", window);
	vi.stubGlobal("document", document);
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	container = document.createElement("div") as unknown as HTMLElement;
	document.body.appendChild(container as never);
	root = createRoot(container);
});
afterEach(async () => {
	await act(() => root.unmount());
	vi.unstubAllGlobals();
	vi.resetAllMocks();
});

async function render(actor: Record<string, unknown>) {
	await act(() =>
		root.render(
			<QueryClientProvider client={new QueryClient()}>
				<AccountSecurity actor={actor as never} onSignedOut={signedOut} />
			</QueryClientProvider>,
		),
	);
}

function button(text: string): HTMLButtonElement | undefined {
	return [...container.querySelectorAll("button")].find((el) => el.textContent?.includes(text));
}

function input(label: string): HTMLInputElement {
	const match = [...container.querySelectorAll("label")].find((el) => el.textContent === label);
	return match?.parentElement?.querySelector("input") as HTMLInputElement;
}

async function type(el: HTMLInputElement, value: string) {
	const key = Object.keys(el).find((k) => k.startsWith("__reactProps$"));
	const props = (el as unknown as Record<string, { onChange?(e: { target: { value: string } }): void }>)[key ?? ""];
	if (!props?.onChange) throw new Error("input has no React onChange prop");
	await act(async () => props.onChange?.({ target: { value } }));
}

async function click(el: HTMLButtonElement | undefined) {
	if (!el) throw new Error("button missing");
	await act(async () => el.dispatchEvent(new window.Event("click", { bubbles: true })));
}

describe("AccountSecurity", () => {
	it("shows both bindings masked and offers bind when nothing is bound", async () => {
		await render({ id: "u1", name: "我", kind: "human" });
		expect(container.textContent).toContain("手机号");
		expect(container.textContent).toContain("邮箱");
		expect(container.textContent?.match(/未绑定/g)).toHaveLength(2);
		expect(button("绑定")).not.toBeUndefined();
	});

	it("masks an already bound phone and email", async () => {
		await render({ id: "u1", name: "我", kind: "human", phone: "13800001234", email: "alice@example.com" });
		expect(container.textContent).toContain("138****1234");
		expect(container.textContent).toContain("a****@example.com");
		expect(container.textContent).toContain("换绑");
	});

	it("binds a phone through send-code + confirm and asks to sign in again", async () => {
		api.sendBindCode.mockResolvedValue({ sent: true, retryAfter: 60 });
		api.confirmBindCode.mockResolvedValue(undefined);
		await render({ id: "u1", name: "我", kind: "human" });
		await click(button("绑定"));
		await type(input("手机号"), "13800001234");
		await click(button("发送验证码"));
		expect(api.sendBindCode).toHaveBeenCalledWith("phone", "13800001234");
		await type(input("验证码"), "123456");
		await act(async () => {
			container.querySelector("form")?.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
		});
		expect(api.confirmBindCode).toHaveBeenCalledWith("phone", "13800001234", "123456");
		expect(container.textContent).toContain("手机号已绑定");
		expect(container.textContent).toContain("已退出所有设备上的登录");
		await click(button("去重新登录"));
		expect(signedOut).toHaveBeenCalledTimes(1);
	});

	it("says the target is taken when the server rejects with 409", async () => {
		api.sendBindCode.mockResolvedValue({ sent: true, retryAfter: 60 });
		api.confirmBindCode.mockRejectedValue({ status: 409, code: "phone_taken" });
		await render({ id: "u1", name: "我", kind: "human", phone: "13800001111" });
		await click(button("换绑"));
		await type(input("手机号"), "13800001234");
		await click(button("发送验证码"));
		await type(input("验证码"), "123456");
		await act(async () => {
			container.querySelector("form")?.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
		});
		expect(container.querySelector('[role="alert"]')?.textContent).toBe("这个手机号已绑定其他账号");
		expect(container.textContent).not.toContain("已退出所有设备上的登录");
	});

	it("binds an email through the email kind", async () => {
		api.sendBindCode.mockResolvedValue({ sent: true, retryAfter: 30 });
		api.confirmBindCode.mockResolvedValue(undefined);
		await render({ id: "u1", name: "我", kind: "human" });
		const section = container.querySelector('section[aria-label="邮箱"]') as HTMLElement;
		await click([...section.querySelectorAll("button")].find((el) => el.textContent === "绑定") as HTMLButtonElement);
		await type(input("邮箱"), " Alice@Example.COM ");
		await click(button("发送验证码"));
		expect(api.sendBindCode).toHaveBeenCalledWith("email", "alice@example.com");
	});
});
