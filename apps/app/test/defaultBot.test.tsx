import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CreateBotEntry } from "../src/components/CreateBotEntry";
import { OnboardingFlow } from "../src/components/OnboardingFlow";
import { PersonalAgentGate } from "../src/components/PersonalAgentGate";
import { CHINESE_BOT_NAMES, ENGLISH_BOT_NAMES, pickBotName } from "../src/lib/botNames";
import { $onboardingOpen } from "../src/lib/onboarding";
import { $session } from "../src/store";

const api = vi.hoisted(() => ({ contacts: vi.fn(), updateProfile: vi.fn(), createBot: vi.fn(), openDm: vi.fn() }));
vi.mock("../src/api", () => ({ api }));
vi.mock("../src/ui/Toast", () => ({ toast: vi.fn() }));

let container: HTMLElement;
let root: Root;
beforeEach(() => {
	const { document, window } = parseHTML("<html><body></body></html>");
	vi.stubGlobal("window", window);
	vi.stubGlobal("document", document);
	vi.stubGlobal("location", { href: "http://localhost/", origin: "http://localhost" });
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
	container = document.createElement("div") as unknown as HTMLElement;
	document.body.appendChild(container as never);
	root = createRoot(container);
	$session.set({ actor: { id: "me", kind: "human", name: "Me" } });
	$onboardingOpen.set(false);
});
afterEach(async () => {
	await act(() => root.unmount());
	$session.set(undefined);
	$onboardingOpen.set(false);
	vi.unstubAllGlobals();
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

const fill = async (input: HTMLInputElement, value: string) => {
	const key = Object.keys(input).find((k) => k.startsWith("__reactProps"));
	const props = (input as unknown as Record<string, { onChange?(e: { target: { value: string } }): void }>)[key ?? ""];
	await act(async () => props.onChange?.({ target: { value } }));
};

const submit = async () => {
	await act(async () => {
		container.querySelector("form")?.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
	});
};

describe("引导入口（还没有自己的 Bot 时）", () => {
	it("账号没有任何自己的 Bot 时显示「创建你的 bot」入口", async () => {
		api.contacts.mockResolvedValue([{ id: "f1", kind: "agent", name: "别人的", ownerId: "other" }]);
		await render(<CreateBotEntry />);
		expect(container.textContent).toContain("创建你的 bot");
	});

	it("已有自己的 Bot 时不显示入口", async () => {
		api.contacts.mockResolvedValue([{ id: "a9", kind: "agent", name: "我的", ownerId: "me" }]);
		await render(<CreateBotEntry />);
		expect(container.textContent).toBe("");
	});

	it("访客账号不显示入口，也不查联系人", async () => {
		$session.set({ actor: { id: "g", kind: "human", name: "G", anonymous: true } });
		await render(<CreateBotEntry />);
		expect(container.textContent).toBe("");
		expect(api.contacts).not.toHaveBeenCalled();
	});

	it("联系人没加载完不显示入口", async () => {
		api.contacts.mockReturnValue(new Promise(() => {}));
		await render(<CreateBotEntry />);
		expect(container.textContent).toBe("");
	});
});

describe("守门组件", () => {
	it("默认放行，打开开关时挂出全屏引导", async () => {
		await render(
			<PersonalAgentGate>
				<p>chat-list</p>
			</PersonalAgentGate>,
		);
		expect(container.textContent).toContain("chat-list");
		act(() => $onboardingOpen.set(true));
		expect(container.textContent).toContain("你的名字");
		expect(container.textContent).toContain("chat-list");
		// 一屏一步：web（无原生壳）上只有名字一步，创建步要等下一步才出现。
		expect(container.querySelectorAll("form")).toHaveLength(1);
		expect(container.textContent).not.toContain("创建你的 bot");
	});

	it("走完流程：存名字 → （web 跳过授权）→ 建 Bot → 开私聊 → 关闭引导", async () => {
		api.updateProfile.mockResolvedValue({ id: "me", kind: "human", name: "周远" });
		api.createBot.mockResolvedValue({ id: "a2", kind: "agent", name: "小舟", ownerId: "me" });
		api.openDm.mockResolvedValue({ id: "conv1", kind: "dm", title: "小舟", memberIds: ["me", "a2"] });
		let done = 0;
		await render(<OnboardingFlow onDone={() => (done += 1)} />);

		// 第一步：名字
		await fill(container.querySelector("input") as HTMLInputElement, "周远");
		await submit();
		expect(api.updateProfile).toHaveBeenCalledWith({ name: "周远" });

		// 不在原生壳里：授权步整步跳过，直接到创建 Bot
		expect(container.textContent).toContain("创建你的 bot");
		const inputs = [...container.querySelectorAll("input")];
		await fill(inputs[0] as HTMLInputElement, "小舟");
		await submit();
		expect(api.createBot).toHaveBeenCalledWith({ name: "小舟" });
		expect(api.openDm).toHaveBeenCalledWith("a2");

		await act(async () => {
			await new Promise((r) => setTimeout(r, 0));
		});
		expect(done).toBe(1);
	});
});

describe("名字骰子", () => {
	it("中文界面从中文名单取，英文界面从英文名单取", () => {
		expect(CHINESE_BOT_NAMES).toContain(pickBotName("zh", () => 0));
		expect(ENGLISH_BOT_NAMES).toContain(pickBotName("en", () => 0));
	});

	it("名单规模与去重：中文名单 70–90 个，没有重复", () => {
		expect(CHINESE_BOT_NAMES.length).toBeGreaterThanOrEqual(70);
		expect(CHINESE_BOT_NAMES.length).toBeLessThanOrEqual(90);
		expect(new Set(CHINESE_BOT_NAMES).size).toBe(CHINESE_BOT_NAMES.length);
		expect(ENGLISH_BOT_NAMES.length).toBeGreaterThanOrEqual(40);
		expect(new Set(ENGLISH_BOT_NAMES).size).toBe(ENGLISH_BOT_NAMES.length);
	});

	it("中文名是 2–3 字，没有小明", () => {
		for (const name of CHINESE_BOT_NAMES) {
			expect(name.length).toBeGreaterThanOrEqual(2);
			expect(name.length).toBeLessThanOrEqual(3);
			expect(name).not.toBe("小明");
		}
	});

	it("随机数偏向两端时也只出名单内的名字", () => {
		expect(pickBotName("zh", () => 0.999999)).toBe(CHINESE_BOT_NAMES[CHINESE_BOT_NAMES.length - 1]);
		expect(pickBotName("en", () => 0)).toBe(ENGLISH_BOT_NAMES[0]);
	});
});
