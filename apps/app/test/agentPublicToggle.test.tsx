import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentPublicToggle } from "../src/components/AgentPublicToggle";

const api = vi.hoisted(() => ({ setAgentPublic: vi.fn() }));
vi.mock("../src/api", () => ({ api }));
vi.mock("../src/ui/Toast", () => ({ toast: vi.fn() }));

let container: HTMLElement;
let root: Root;
beforeEach(() => {
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

async function render(node: React.ReactNode) {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	await act(async () => root.render(<QueryClientProvider client={client}>{node}</QueryClientProvider>));
	return client;
}

/** React 的 onChange 挂在 fiber props 上；linkedom 的 click 不产生受控 change，直接调用。 */
function change(input: HTMLInputElement) {
	const key = Object.keys(input).find((k) => k.startsWith("__reactProps$")) ?? "";
	const props = (input as unknown as Record<string, { onChange(e: unknown): Promise<void> }>)[key];
	return props.onChange;
}

describe("AgentPublicToggle", () => {
	it("calls the cloud endpoint and shows the new value while saving (JV2-J03-05)", async () => {
		let resolve: (value: unknown) => void = () => {};
		api.setAgentPublic.mockReturnValue(new Promise((done) => (resolve = done)));
		await render(<AgentPublicToggle actor={{ id: "a1", kind: "agent", name: "A", public: false }} />);
		const input = container.querySelector("input") as HTMLInputElement;
		expect(input.checked).toBe(false);
		// 不 await：请求还挂着时界面已经按新值显示。
		let saving: Promise<void> | undefined;
		await act(async () => {
			saving = change(input)({ target: { checked: true } });
		});
		expect(api.setAgentPublic).toHaveBeenCalledWith("a1", true);
		expect(input.checked).toBe(true);
		await act(async () => {
			resolve({ id: "a1", kind: "agent", name: "A", public: true });
			await saving;
		});
		expect(container.querySelector('[role="alert"]')).toBeNull();
	});

	it("rolls back to the server value and reports the reason when the request fails", async () => {
		api.setAgentPublic.mockRejectedValue(new Error("forbidden"));
		await render(<AgentPublicToggle actor={{ id: "a1", kind: "agent", name: "A", public: false }} />);
		const input = container.querySelector("input") as HTMLInputElement;
		await act(async () => {
			await change(input)({ target: { checked: true } });
		});
		expect(input.checked).toBe(false);
		expect(container.querySelector('[role="alert"]')?.textContent).toBe("forbidden");
		expect(input.disabled).toBe(false);
	});
});
