import { parseHTML } from "linkedom";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { RpcError } from "../src/work/api/client";
import { Composer } from "../src/work/ui/Composer";

const send = vi.hoisted(() => vi.fn());
vi.mock("../src/work/api/client", async (original) => ({
	...(await original<typeof import("../src/work/api/client")>()),
	rpc: send,
}));
vi.mock("../src/work/ui/ComposerAssist", () => ({
	AssistBar: () => null,
	AssistMenu: () => null,
	parseSlash: () => null,
}));

it("未知结果只在用户重试相同草稿时复用 requestId，编辑后使用新 ID", async () => {
	const { document, window } = parseHTML("<html><body></body></html>");
	vi.stubGlobal("window", window);
	vi.stubGlobal("document", document);
	vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
	const node = document.createElement("div");
	const root = createRoot(node as never);
	await act(() => root.render(<Composer session="unknown-test" running={false} />));
	const type = async (value: string) => {
		const el = node.querySelector("textarea") as unknown as HTMLElement;
		const key = Object.keys(el).find((k) => k.startsWith("__reactProps$")) ?? "";
		await act(() =>
			(el as unknown as Record<string, { onChange(event: unknown): void }>)[key]?.onChange({ target: { value } }),
		);
	};
	const click = async () => {
		await act(async () => (node.querySelector('button[aria-label="发送"]') as unknown as HTMLElement).click());
	};
	send.mockRejectedValue(new RpcError("outcome_unknown", "结果未知"));
	await type("测试");
	await click();
	await click();
	expect(send).toHaveBeenCalledTimes(2);
	expect(send.mock.calls[0]?.[1].requestId).toBe(send.mock.calls[1]?.[1].requestId);
	await type("修改");
	await click();
	expect(send.mock.calls[2]?.[1].requestId).not.toBe(send.mock.calls[1]?.[1].requestId);
	await act(() => root.unmount());
	vi.unstubAllGlobals();
});
