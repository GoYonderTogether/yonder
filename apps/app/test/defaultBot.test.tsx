import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CreateBotDialog } from "../src/components/CreateBotDialog";
import { PersonalAgentGate } from "../src/components/PersonalAgentGate";
import { $session } from "../src/store";

const api = vi.hoisted(() => ({ contacts: vi.fn(), ensureDefaultBot: vi.fn(), createBot: vi.fn() }));
vi.mock("../src/api", () => ({ api }));
vi.mock("radix-ui", async () => {
	const { createElement: h, Fragment } = await import("react");
	const box = (tag: string) => (p: { children?: React.ReactNode }) => h(tag, null, p.children);
	return {
		Dialog: {
			Root: (p: { open: boolean; children?: React.ReactNode }) => (p.open ? h(Fragment, null, p.children) : null),
			Portal: box("div"),
			Overlay: () => null,
			Content: box("section"),
			Title: box("h2"),
			Description: box("p"),
			Close: (p: { children?: React.ReactNode }) => h(Fragment, null, p.children),
		},
	};
});
vi.mock("../src/ui/Toast", () => ({ toast: vi.fn() }));

let container: HTMLElement;
let root: Root;
beforeEach(() => {
	const { document, window } = parseHTML("<html><body></body></html>");
	vi.stubGlobal("window", window);
	vi.stubGlobal("document", document);
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
	container = document.createElement("div") as unknown as HTMLElement;
	document.body.appendChild(container as never);
	root = createRoot(container);
	$session.set({ actor: { id: "me", kind: "human", name: "Me" } });
	// 有 VITE_API=http 时 useSocialService 直接判定有社交服务。
	vi.stubEnv("VITE_API", "http");
});
afterEach(async () => {
	await act(() => root.unmount());
	$session.set(undefined);
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
	vi.resetAllMocks();
});

async function render(node: React.ReactNode) {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	await act(async () =>
		root.render(
			<QueryClientProvider client={client}>
				<MemoryRouter>{node}</MemoryRouter>
			</QueryClientProvider>,
		),
	);
	await act(async () => {
		await new Promise((r) => setTimeout(r, 0));
	});
}

describe("默认 Bot 小歪", () => {
	it("账号没有任何自己的 Bot 时自动创建一次（并发渲染也只一次）", async () => {
		api.contacts.mockResolvedValue([{ id: "f1", kind: "agent", name: "别人的", ownerId: "other" }]);
		api.ensureDefaultBot.mockResolvedValue({ id: "a1", kind: "agent", name: "小歪", ownerId: "me" });
		await render(
			<>
				<PersonalAgentGate>
					<p>chat-list</p>
				</PersonalAgentGate>
				<PersonalAgentGate>
					<p>second</p>
				</PersonalAgentGate>
			</>,
		);
		expect(container.textContent).toContain("chat-list");
		expect(api.ensureDefaultBot).toHaveBeenCalledTimes(1);
		expect(api.ensureDefaultBot).toHaveBeenCalledWith({ name: "小歪", englishName: "Yonder Bot" });
	});

	it("已有自己的 Bot 时不创建，也不拦截到选择页", async () => {
		api.contacts.mockResolvedValue([{ id: "a9", kind: "agent", name: "我的", ownerId: "me" }]);
		await render(
			<PersonalAgentGate>
				<p>chat-list</p>
			</PersonalAgentGate>,
		);
		expect(container.textContent).toContain("chat-list");
		expect(api.ensureDefaultBot).not.toHaveBeenCalled();
	});

	it("访客账号不创建", async () => {
		$session.set({ actor: { id: "g", kind: "human", name: "G", anonymous: true } });
		await render(
			<PersonalAgentGate>
				<p>chat-list</p>
			</PersonalAgentGate>,
		);
		expect(api.contacts).not.toHaveBeenCalled();
		expect(api.ensureDefaultBot).not.toHaveBeenCalled();
	});
});

describe("新建 Bot", () => {
	it("只有名字一个输入项，提交只带 name", async () => {
		api.createBot.mockResolvedValue({ id: "a2", kind: "agent", name: "投资助手" });
		await render(<CreateBotDialog open onOpenChange={() => {}} />);
		const doc = container.ownerDocument;
		const inputs = doc.querySelectorAll("input, select, textarea");
		expect(inputs).toHaveLength(1);
		expect(doc.body.textContent).not.toMatch(/个人|工作|研究|Agent/);
		const input = inputs[0] as HTMLInputElement;
		const key = Object.keys(input).find((k) => k.startsWith("__reactProps"));
		const props = (input as unknown as Record<string, { onChange?(e: { target: { value: string } }): void }>)[
			key ?? ""
		];
		await act(async () => props.onChange?.({ target: { value: "投资助手" } }));
		await act(async () => {
			doc.querySelector("form")?.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
		});
		expect(api.createBot).toHaveBeenCalledWith({ name: "投资助手" });
	});
});
