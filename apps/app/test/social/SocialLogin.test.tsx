import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SocialLogin } from "../../src/features/social/SocialLogin";

const api = vi.hoisted(() => ({ login: vi.fn(), register: vi.fn() }));
vi.mock("../../src/api/social", () => ({ httpApi: api }));

let container: HTMLElement;
let root: Root;
let client: QueryClient;
beforeEach(async () => {
	const { document, window } = parseHTML("<html><body></body></html>");
	vi.stubGlobal("window", window);
	vi.stubGlobal("document", document);
	vi.stubGlobal("location", { search: "", hash: "" });
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	container = document.createElement("div") as unknown as HTMLElement;
	document.body.appendChild(container as never);
	root = createRoot(container);
	client = new QueryClient();
	await act(() =>
		root.render(
			<QueryClientProvider client={client}>
				<SocialLogin />
			</QueryClientProvider>,
		),
	);
});
afterEach(async () => {
	await act(() => root.unmount());
	vi.unstubAllGlobals();
	vi.resetAllMocks();
});

function submit() {
	container.querySelector("form")?.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
}

describe("SocialLogin", () => {
	it("renders the empty login form", () => {
		expect(container.querySelectorAll("input")).toHaveLength(2);
		expect(container.textContent).toContain("没有账号？注册");
	});
	it("shows loading while signing in", async () => {
		api.login.mockReturnValue(new Promise(() => {}));
		await act(() => submit());
		expect([...container.querySelectorAll("button")].find((button) => button.textContent === "登录")?.disabled).toBe(
			true,
		);
	});
	it("navigates after a successful login", async () => {
		const session = { actor: { id: "a", name: "A", kind: "human" } };
		api.login.mockResolvedValue(session);
		await act(async () => submit());
		expect(location.hash).toBe("#/");
		expect(client.getQueryData(["social-session"])).toEqual(session);
	});
	it("renders an error when login fails", async () => {
		api.login.mockRejectedValue(new Error("登录失败"));
		await act(async () => submit());
		expect(container.querySelector('[role="alert"]')?.textContent).toBe("登录失败");
	});
});
