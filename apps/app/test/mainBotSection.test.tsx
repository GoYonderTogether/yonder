import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { MainBot } from "../src/api/types";
import { MainBotSection } from "../src/work/features/settings/MainBotSection";

// 与同目录其他前端测试一致：用 hoisted 的假实现，避免跨文件共享同一个 vi.mock 工厂。
const fake = vi.hoisted(() => ({
	main: null as unknown as MainBot,
	contacts: [] as Array<{ id: string; kind: string; name: string; deviceId?: string }>,
}));
vi.mock("../src/api", () => ({
	api: {
		mainBot: () => Promise.resolve(fake.main),
		contacts: () => Promise.resolve(fake.contacts),
		setMainBot: (input: { location: "cloud" } | { location: "device"; botId: string }) =>
			Promise.resolve(
				input.location === "cloud"
					? { location: "cloud", botId: "bot-cloud", botName: "小未", device: null }
					: {
							location: "device",
							botId: "bot-local",
							botName: "本机助手",
							device: { id: "device-1", name: "我的电脑", kind: "laptop", online: false },
							fallback: { botId: "bot-cloud", botName: "小未" },
						},
			),
	},
}));

fake.main = { location: "cloud", botId: "bot-cloud", botName: "小未", device: null };
fake.contacts = [{ id: "bot-local", kind: "agent", name: "本机助手", deviceId: "device-1" }];

afterEach(() => vi.unstubAllGlobals());

async function render() {
	const { document, window } = parseHTML("<html><body></body></html>");
	vi.stubGlobal("window", window);
	vi.stubGlobal("document", document);
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	const container = document.createElement("div");
	document.body.appendChild(container);
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	await act(async () => {
		createRoot(container).render(
			<QueryClientProvider client={client}>
				<MainBotSection />
			</QueryClientProvider>,
		);
	});
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
	return { html: container.innerHTML, container };
}

it("云端运行时列出设备上的 Bot，并说明移到设备后的离线后果", async () => {
	const { html } = await render();
	expect(html).toContain("小未 在云端运行，用云端额度");
	expect(html).toContain("本机助手");
	expect(html).toContain("移到设备后，那台设备离线时这里没有本机 Bot 可用，消息会由云端 Bot 自动接手。");
});

it("运行在离线设备上时如实警告，并给出接手的云端 Bot", async () => {
	fake.main = {
		location: "device",
		botId: "bot-local",
		botName: "本机助手",
		device: { id: "device-1", name: "我的电脑", kind: "laptop", online: false },
		fallback: { botId: "bot-cloud", botName: "小未" },
	};
	const { html } = await render();
	expect(html).toContain("我的电脑");
	expect(html).toContain("当前离线");
	expect(html).toContain("设备离线期间这里没有本机 Bot 可用，消息会由云端 Bot 自动接手。");
	expect(html).toContain("接手的 Bot 是 小未");
	expect(html).toContain("放回云端");
});
