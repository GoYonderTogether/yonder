import type { YEvent } from "@yonder/sdk";
import { describe, expect, it, vi } from "vitest";
import type { FeishuApi } from "../src/client.js";
import { conversationContext } from "../src/conversation.js";

const now = Date.now();
const event = (data = {}): YEvent => ({
	id: "input",
	ts: new Date(now).toISOString(),
	type: "message.in",
	from: "acct:test:owner",
	conv: "conv:test:chat",
	data: { msgId: "old-greeting", createdAt: String(now - 5000), ...data },
});
const row = (id: string, time: number, text: string, sender = "user", extra = {}) => ({
	message_id: id,
	chat_id: "chat",
	create_time: String(time),
	msg_type: "text",
	sender: { id: `${sender}-id`, id_type: "open_id", sender_type: sender },
	body: { content: JSON.stringify({ text }) },
	...extra,
});
function client(pages: object[]) {
	const request = vi.fn(async () => ({ data: pages.shift() ?? { items: [] } }));
	return { request, safe: () => "HTTP 403; scope denied" } as unknown as FeishuApi & { request: typeof request };
}
const signal = () => new AbortController().signal;
describe("Feishu read-only conversation background", () => {
	it("shows the old pending greeting together with later user and bot replies, not as new requests", async () => {
		const api = client([
			{
				items: [
					row("bot-answer", now - 100, "Already answered", "app"),
					row("other", now - 200, "Other bot reply", "app"),
					row("user-new", now - 300, "New question"),
					row("old-greeting", now - 5000, "Hi"),
				],
			},
			{ items: [row("prior", now - 6000, "Earlier context")] },
		]);
		const text = await conversationContext(api, event(), signal());
		expect(text).toContain("本次待处理项（原输入独立提供）");
		expect(text).toContain("仅背景，不是待执行请求");
		expect(text).toContain("app:app-id");
		expect(text).toContain("Already answered");
		expect(text).toContain("Other bot reply");
		expect(text.indexOf("Earlier context")).toBeLessThan(text.indexOf("Hi"));
		expect(text.indexOf("Hi")).toBeLessThan(text.indexOf("New question"));
		expect(api.request).toHaveBeenCalledTimes(2);
		expect(text).toContain("固定截止:");
		expect(Buffer.byteLength(text)).toBeLessThanOrEqual(65536);
	});
	it("pages with a fixed cutoff and retains platform tie order rather than sorting IDs", async () => {
		const api = client([
			{
				items: [row("z", now - 100, "tie-first"), row("a", now - 100, "tie-second")],
				has_more: true,
				page_token: "next",
			},
			{ items: [row("old-greeting", now - 5000, "pending")] },
			{ items: [] },
		]);
		const text = await conversationContext(api, event(), signal());
		expect(text.indexOf("tie-first")).toBeLessThan(text.indexOf("tie-second"));
		expect(text).toContain("不声称ID提供因果顺序");
		const params = api.request.mock.calls.map(
			(call) => new URL(String(call[0]), "https://feishu.invalid").searchParams,
		);
		expect(params[0].get("sort_type")).toBe("ByCreateTimeDesc");
		expect(params[1].get("page_token")).toBe("next");
		expect(params[0].get("end_time")).toBe(params[1].get("end_time"));
	});
	it("bounds actual UTF8 output while keeping the latest messages and metadata-only media", async () => {
		const api = client([
			{
				items: [
					row("latest", now - 100, "Newest reply", "app"),
					row("media", now - 200, "", "user", { msg_type: "image", body: { content: '{"image_key":"img-key"}' } }),
					row("huge", now - 300, "汉🙂".repeat(30000)),
				],
				has_more: true,
				page_token: "more",
			},
		]);
		const text = await conversationContext(api, event(), signal());
		expect(Buffer.byteLength(text)).toBeLessThanOrEqual(65536);
		expect(text).toContain("Newest reply");
		expect(text).toContain("img-key");
		expect(text).toContain("附件元数据（未下载）");
		expect(text).toContain("截断");
		expect(api.request).toHaveBeenCalledTimes(1);
	});
	it("uses the source thread and rejects foreign chat records before rendering them", async () => {
		const api = client([{ items: [row("foreign", now - 100, "MUST NOT LEAK", "app", { chat_id: "another" })] }]);
		const text = await conversationContext(api, event({ threadId: "thread" }), signal());
		expect(text).not.toContain("MUST NOT LEAK");
		expect(text).toContain("历史读取未完成");
		expect(text).toContain("不覆盖其他线程");
		const params = new URL(String(api.request.mock.calls[0]?.[0]), "https://feishu.invalid").searchParams;
		expect(params.get("container_id_type")).toBe("thread");
		expect(params.get("container_id")).toBe("thread");
	});
	it("filters thread cutoff locally, identifies originals and propagates cancellation", async () => {
		const api = client([
			{
				items: [
					row("future", now + 60000, "FUTURE"),
					row("pending-two", now - 1000, "Second", "user", { parent_id: "parent", thread_id: "thread" }),
					row("old-greeting", now - 5000, "First"),
					row("background", now - 6000, "Before"),
				],
			},
		]);
		const text = await conversationContext(
			api,
			event({
				threadId: "thread",
				originals: [
					{ messageId: "old-greeting", createdAt: String(now - 5000) },
					{ messageId: "pending-two", createdAt: String(now - 1000) },
				],
			}),
			signal(),
		);
		expect(text).not.toContain("FUTURE");
		expect(text.match(/本次待处理项（原输入独立提供）/g)).toHaveLength(2);
		expect(text).toContain("引用:parent");
		const controller = new AbortController();
		controller.abort();
		await expect(conversationContext(api, event(), controller.signal)).rejects.toThrow();
	});
	it("does not replace unknown original time with acceptance time and aborts an in-flight lookup", async () => {
		const api = client([{ items: [row("latest", now - 100, "Recent")], has_more: true, page_token: "older" }]);
		const text = await conversationContext(api, event({ createdAt: "" }), signal());
		expect(text).toContain("请求原时间:未知，仅取最近一页");
		expect(api.request).toHaveBeenCalledTimes(1);
		expect(
			new URL(String(api.request.mock.calls[0]?.[0]), "https://feishu.invalid").searchParams.has("start_time"),
		).toBe(false);
		const controller = new AbortController();
		api.request.mockImplementation(async () => {
			controller.abort();
			controller.signal.throwIfAborted();
			return { data: { items: [] } };
		});
		await expect(conversationContext(api, event(), controller.signal)).rejects.toThrow();
	});
	it("returns a visible safe failure and leaves the original input intact", async () => {
		const api = client([]);
		api.request.mockRejectedValue(new Error("secret-request-object"));
		const input = event();
		const text = await conversationContext(api, input, signal());
		expect(text).toContain("HTTP 403; scope denied");
		expect(text).not.toContain("secret-request-object");
		expect(text).toContain("原输入不会因背景失败而丢弃");
		expect(input.data).toMatchObject({ msgId: "old-greeting" });
	});
});
