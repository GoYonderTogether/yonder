import type { PluginAPI, ToolContext } from "@yonder/sdk";
import { createRegistrationCollector } from "@yonder/sdk/testing";
import { describe, expect, it, vi } from "vitest";
import { FeishuChannel } from "../src/channel.js";
import { FeishuApi, FeishuRequestError } from "../src/client.js";
import plugin from "../src/index.js";
import { cancellable, chunks, parseContent, textPayload } from "../src/protocol.js";

const config = { appId: "protocol-test", secret: "unread" };
function api() {
	return {
		...createRegistrationCollector().api,
		paths: { data: "/unused-feishu-protocol-test" },
		log: { warn: vi.fn() },
	} as PluginAPI;
}
describe("Feishu protocol receipts (no network or model)", () => {
	it("distinguishes platform rejection from an unreadable send receipt", async () => {
		const client = new FeishuApi(config, api());
		for (const response of [
			new Response("", { status: 403 }),
			Response.json({ code: 99991672, error: { permission_violations: [{ subject: "im:message" }] } }),
		]) {
			vi.spyOn(client, "raw").mockResolvedValueOnce(response);
			await expect(client.request("/im/v1/messages", "POST", {})).rejects.toMatchObject({ uncertain: false });
		}
		for (const response of [
			new Response("broken JSON"),
			Response.json({ data: {} }),
			new Response("", { status: 503 }),
		]) {
			vi.spyOn(client, "raw").mockResolvedValueOnce(response);
			await expect(client.request("/im/v1/messages", "POST", {})).rejects.toMatchObject({ uncertain: true });
		}
	});
	it("keeps uncertainty and the last confirmed native message id", async () => {
		const channel = new FeishuChannel("test", { ...config, textChunkBytes: 256 }, api());
		vi.spyOn(channel, "rawSend")
			.mockResolvedValueOnce("om_confirmed")
			.mockRejectedValueOnce(new FeishuRequestError("connection lost after dispatch", true));
		await expect(channel.send("conv:test:chat", { text: "x".repeat(600) })).resolves.toMatchObject({
			ok: false,
			id: "om_confirmed",
			uncertain: true,
		});
		const rejected = new FeishuChannel("test", config, api());
		vi.spyOn(rejected, "rawSend").mockRejectedValueOnce(new FeishuRequestError("permission denied", false));
		expect(await rejected.send("conv:test:chat", { text: "content" })).not.toHaveProperty("uncertain");
	});
	it("visible streaming card keeps its id on close uncertainty without sending a replacement", async () => {
		const channel = new FeishuChannel("test", config, api());
		const send = vi.spyOn(channel, "rawSend").mockResolvedValue("om_card");
		const request = vi.spyOn(channel.client, "request").mockImplementation(async (path) => {
			if (path === "/cardkit/v1/cards") return { code: 0, data: { card_id: "card_native" } };
			if (path.endsWith("/settings")) throw new FeishuRequestError("close connection lost", true);
			return { code: 0 };
		});
		async function* output() {
			yield { type: "final" as const, text: "complete" };
		}
		await expect(channel.stream("conv:test:chat", output())).resolves.toMatchObject({
			ok: false,
			id: "om_card",
			uncertain: true,
		});
		expect(send).toHaveBeenCalledTimes(1);
		const missingId = new FeishuChannel("test", config, api());
		vi.spyOn(missingId.client, "request").mockResolvedValue({ code: 0, data: {} });
		await expect(missingId.stream("conv:test:chat", output())).resolves.toMatchObject({ ok: false, uncertain: true });
		expect(request.mock.calls.filter(([path]) => path.endsWith("/settings"))).toHaveLength(1);
	});
	it("ordinary tool forwards the exact execution context to shared delivery", async () => {
		const { api: base, registrations } = createRegistrationCollector();
		const send = vi.fn(async (..._args: unknown[]) => ({ ok: false, uncertain: true }));
		plugin.setup({ ...base, paths: { data: "/unused" }, messages: { send } } as unknown as PluginAPI);
		registrations.channels[0]?.create("test", config);
		const ctx = { signal: new AbortController().signal, session: "session:1" } as ToolContext;
		const tool = registrations.tools.find((tool) => tool.name === "channel-feishu_message");
		const result = await tool?.execute(
			{ instance: "test", to: "conv:test:chat", text: "content", replyTo: "om_original" },
			ctx,
		);
		expect(send.mock.calls[0]?.[1]).toBe(ctx);
		expect(send.mock.calls[0]?.[0]).toMatchObject({ replyTo: "om_original" });
		expect(result?.isError).toBe(true);
		for (const invalid of [
			{ instance: "test", to: "conv:test:chat", text: 42 },
			{
				instance: "test",
				to: "conv:test:chat",
				text: "",
				attachments: [{ kind: "image", mime: "image/png", uri: "file:///unused", bytes: -1 }],
			},
		])
			expect((await tool?.execute(invalid, ctx))?.isError).toBe(true);
		expect(send).toHaveBeenCalledTimes(1);
	});
	it("preserves inbound resource kinds and UTF-8 chunk limits", () => {
		expect(parseContent("media", JSON.stringify({ file_key: "video", image_key: "cover" })).resources).toEqual([
			{ key: "video", kind: "video" },
			{ key: "cover", kind: "image" },
		]);
		const encode = (text: string) => textPayload(text, "markdown").content;
		const text = '中文🙂"\\'.repeat(100);
		const parts = chunks(text, 256, encode);
		expect(parts.join("")).toBe(text);
		expect(parts.every((part) => Buffer.byteLength(JSON.stringify(encode(part))) <= 256)).toBe(true);
	});
	it("cancel interrupts an idle streaming producer", async () => {
		const controller = new AbortController();
		const iterator = cancellable(
			{ [Symbol.asyncIterator]: () => ({ next: () => new Promise<never>(() => {}) }) },
			controller.signal,
		);
		const waiting = iterator.next();
		controller.abort();
		await expect(waiting).rejects.toThrow("cancelled");
	});
});
