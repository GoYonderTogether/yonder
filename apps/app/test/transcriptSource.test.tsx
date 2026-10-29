import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import type { ChatItem } from "../src/work/lib/chat";
import { fromLabel, Transcript } from "../src/work/ui/Transcript";

/**
 * 通知行的来源名（E2E-08）：控制台主人写「你」，Bot 写显示名，认不出的来源整段不写。
 * 内部账号 id（acct:…）绝不直接出现在界面上。
 */
const rpc = vi.hoisted(() => vi.fn());
vi.mock("../src/work/api/client", async (importOriginal) => ({ ...(await importOriginal<object>()), rpc }));

const NAMES = new Map([["main", "Yonder"]]);

test("maps known sources to user-facing names and hides the rest", () => {
	expect(fromLabel("acct:console:owner", NAMES)).toBe("你");
	expect(fromLabel("acct:agent:main", NAMES)).toBe("Yonder");
	expect(fromLabel("agent:main", NAMES)).toBe("Yonder");
	// 外部渠道账号、会话标识、没有显示名的 Bot：都不猜，直接不显示来源
	expect(fromLabel("acct:qq:10001", NAMES)).toBeUndefined();
	expect(fromLabel("conv:console:main", NAMES)).toBeUndefined();
	expect(fromLabel("acct:agent:ghost", NAMES)).toBeUndefined();
	expect(fromLabel(undefined, NAMES)).toBeUndefined();
	expect(fromLabel("acct:console:owner")).toBe("你");
});

const notice = (id: string, from: string, text: string): ChatItem => ({ id, role: "notice", from, text, tools: [] });

test("notice rows never render an internal account id", async () => {
	const { window } = parseHTML("<html><body><div id='root'></div></body></html>");
	vi.stubGlobal("window", window);
	vi.stubGlobal("document", window.document);
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	rpc.mockImplementation(async (method: string) => {
		if (method === "bots.list") return { bots: [{ agent: "main", name: "Yonder" }] };
		throw new Error(`Unexpected ${method}`);
	});
	const container = window.document.getElementById("root") as unknown as HTMLElement;
	const root = createRoot(container);
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	try {
		await act(async () => {
			root.render(
				<QueryClientProvider client={client}>
					<Transcript
						items={[
							notice("n1", "acct:console:owner", "你好，只回复OK"),
							notice("n2", "acct:agent:main", "任务已完成"),
							notice("n3", "acct:qq:10001", "外部提醒"),
						]}
						hasMore={false}
						onOlder={() => undefined}
					/>
				</QueryClientProvider>,
			);
		});
		await vi.waitFor(() => expect(container.textContent).toContain("通知 · Yonder：任务已完成"));
		expect(container.textContent).toContain("通知 · 你：你好，只回复OK");
		expect(container.textContent).toContain("通知：外部提醒");
		expect(container.textContent).not.toContain("acct:");
		expect(container.textContent).not.toContain("agent:");
	} finally {
		await act(async () => root.unmount());
		client.clear();
		vi.unstubAllGlobals();
		rpc.mockReset();
	}
});
