import type { PluginAPI, ToolContext } from "@yonder/sdk";
import { createRegistrationCollector } from "@yonder/sdk/testing";
import { describe, expect, it, vi } from "vitest";
import { FeishuChannel } from "../src/channel.js";
import { FeishuApi, FeishuRequestError } from "../src/client.js";
import plugin from "../src/index.js";
import { FeishuInteraction } from "../src/interaction.js";
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
	it("preserves HTTP, native code and explicit permission subjects on non-2xx platform errors", async () => {
		const client = new FeishuApi(config, api());
		const raw = vi.spyOn(client, "raw");
		for (const status of [400, 403, 503]) {
			raw.mockResolvedValueOnce(
				Response.json(
					{
						code: 99991672,
						msg: "Access denied",
						error: {
							permission_violations: [
								{ type: "action", subject: "im:chat.members:read" },
								{ type: "action", subject: "im:chat:readonly" },
							],
						},
					},
					{ status },
				),
			);
			await expect(
				client.request("/im/v1/chats/chat/members?member_id_type=open_id", "POST", {}),
			).rejects.toMatchObject({
				message: `Feishu /im/v1/chats/chat/members: HTTP ${status}; code=99991672; msg=Access denied; required permissions=im:chat.members:read,im:chat:readonly; check application scopes, publication and tenant access`,
				uncertain: status >= 500,
			});
		}
		expect(raw).toHaveBeenCalledTimes(3);
		raw.mockResolvedValueOnce(Response.json({ code: 0, data: { items: [] } }));
		await expect(client.request("/im/v1/messages")).resolves.toEqual({ code: 0, data: { items: [] } });
		expect(raw).toHaveBeenCalledTimes(4);
	});
	it("retains HTTP diagnostics without trusting malformed or success-shaped error bodies", async () => {
		const client = new FeishuApi(config, api());
		const raw = vi.spyOn(client, "raw");
		for (const status of [400, 503]) {
			for (const body of ["", "<html>gateway error</html>", "null", '{"code":"99991672"}', '{"data":{}}']) {
				raw.mockResolvedValueOnce(new Response(body, { status }));
				await expect(client.request("/im/v1/messages", "POST", {})).rejects.toMatchObject({
					message: `Feishu /im/v1/messages: HTTP ${status}`,
					uncertain: status >= 500,
				});
			}
		}
		raw.mockResolvedValueOnce(Response.json({ code: 0 }, { status: 400 }));
		await expect(client.request("/im/v1/messages", "POST", {})).rejects.toMatchObject({
			message: "Feishu /im/v1/messages: HTTP 400; code=0",
			uncertain: false,
		});
		expect(raw).toHaveBeenCalledTimes(11);
	});
	it("bounds non-2xx reads and retains HTTP when the body cannot be read", async () => {
		const client = new FeishuApi(config, api());
		for (const status of [400, 503]) {
			const cancel = vi.fn();
			const body = new ReadableStream<Uint8Array>({
				start(controller) {
					controller.enqueue(new Uint8Array(2 * 1024 * 1024 + 1));
				},
				cancel,
			});
			vi.spyOn(client, "raw").mockResolvedValueOnce(new Response(body, { status }));
			await expect(client.request("/im/v1/messages", "POST", {})).rejects.toMatchObject({
				message: `Feishu /im/v1/messages: HTTP ${status}`,
				uncertain: status >= 500,
			});
			expect(cancel).toHaveBeenCalledTimes(1);
			const broken = new ReadableStream<Uint8Array>({
				start(controller) {
					controller.error(new Error("untrusted body failure"));
				},
			});
			vi.spyOn(client, "raw").mockResolvedValueOnce(new Response(broken, { status }));
			await expect(client.request("/im/v1/messages", "POST", {})).rejects.toMatchObject({
				message: `Feishu /im/v1/messages: HTTP ${status}`,
				uncertain: status >= 500,
			});
		}
	});
	it("redacts credentials from permission subjects and never includes raw platform objects", async () => {
		const base = api();
		base.credentials = { get: vi.fn(async () => ({ type: "api_key" as const, key: "protocol-secret" })) };
		const client = new FeishuApi(config, base);
		const fetch = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValueOnce(Response.json({ code: 0, tenant_access_token: "protocol-token", expire: 7200 }))
			.mockResolvedValueOnce(
				Response.json(
					{
						code: 99991672,
						msg: "protocol-secret protocol-token untrusted-message",
						request: { app_secret: "protocol-secret" },
						error: { permission_violations: [{ subject: "im:message protocol-secret protocol-token" }] },
					},
					{ status: 400 },
				),
			);
		try {
			await expect(client.request("/im/v1/messages", "POST", {})).rejects.toMatchObject({
				message:
					"Feishu /im/v1/messages: HTTP 400; code=99991672; msg=[redacted] [redacted] untrusted-message; required permissions=im:message [redacted] [redacted]; check application scopes, publication and tenant access",
				uncertain: false,
			});
			expect(fetch).toHaveBeenCalledTimes(2);
		} finally {
			fetch.mockRestore();
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
	it("ordinary automatic replies use the same policy while explicit replies stay explicit", async () => {
		const channel = new FeishuChannel("test", config, api());
		const policy = vi
			.spyOn(FeishuInteraction.prototype, "beforeReply")
			.mockResolvedValueOnce(undefined)
			.mockResolvedValueOnce("om_explicit");
		const send = vi.spyOn(channel, "rawSend").mockResolvedValue("om_sent");
		try {
			await channel.send("conv:test:chat", { text: "reply", sourceMessageId: "om_source" });
			expect(policy.mock.calls[0]).toEqual(["conv:test:chat", "om_source", undefined]);
			expect(send.mock.calls[0]?.[3]).toBeUndefined();
			await channel.send("conv:test:chat", { text: "reply", replyTo: "om_explicit" });
			expect(send.mock.calls[1]?.[3]).toBe("om_explicit");
		} finally {
			policy.mockRestore();
		}
	});
	it("tool-only or empty output creates no visible streaming card", async () => {
		const channel = new FeishuChannel("test", config, api());
		const request = vi.spyOn(channel.client, "request");
		const send = vi.spyOn(channel, "rawSend");
		async function* output() {
			yield { type: "tool" as const, phase: "start" as const, name: "read" };
			yield { type: "final" as const, text: "" };
		}
		await expect(channel.stream("conv:test:chat", output(), "om_source")).resolves.toMatchObject({ ok: true });
		expect(request).not.toHaveBeenCalled();
		expect(send).not.toHaveBeenCalled();
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
	it("history scope uses actual run sources and requires admin for other chats", async () => {
		const { api: base, registrations } = createRegistrationCollector();
		plugin.setup({ ...base, paths: { data: "/unused" } } as PluginAPI);
		registrations.channels[0]?.create("test", config);
		const history = vi.spyOn(FeishuChannel.prototype, "history").mockResolvedValue({ items: [] });
		const tool = registrations.tools.find((tool) => tool.name === "channel-feishu_history");
		const ctx = {
			capabilities: ["read", "network"],
			signal: new AbortController().signal,
			event: { conv: "conv:test:source" },
		} as ToolContext;
		expect((await tool?.execute({ instance: "test", chat: "other" }, ctx))?.isError).toBe(true);
		expect(history).not.toHaveBeenCalled();
		expect((await tool?.execute({ instance: "test" }, ctx))?.isError).toBeUndefined();
		expect(history.mock.calls[0]?.[0]).toEqual({ chat: "source" });
		expect(
			(await tool?.execute({ instance: "test", chat: "other" }, { ...ctx, capabilities: ["admin", "read", "network"] }))
				?.isError,
		).toBeUndefined();
		expect(history.mock.calls[1]?.[0]).toEqual({ chat: "other" });
		history.mockRestore();
	});
	it("registers source-scoped turn context without fetching for CLI inputs", async () => {
		const { api: base, registrations } = createRegistrationCollector();
		plugin.setup({
			...base,
			paths: { data: "/unused" },
			events: { ...base.events, query: async () => ({ events: [] }) },
		} as PluginAPI);
		const channel = (await registrations.channels[0]?.create("test", config)) as FeishuChannel;
		const request = vi.spyOn(channel.client, "request").mockResolvedValue({ data: { items: [] } });
		const contribution = registrations.contexts.find((item) => item.id === "channel-feishu.conversation");
		expect(contribution?.placement).toBe("turn");
		const ctx = {
			agent: "main",
			profile: "owner",
			session: "2",
			workspace: { read: async () => undefined },
			signal: new AbortController().signal,
			event: { id: "input", ts: new Date().toISOString(), type: "message.in", conv: "conv:cli:local", data: {} },
		};
		expect(await contribution?.render(ctx)).toBeUndefined();
		expect(request).not.toHaveBeenCalled();
		const rendered = await contribution?.render({
			...ctx,
			event: { ...ctx.event, conv: "conv:test:chat", data: { msgId: "pending", createdAt: "1000" } },
		});
		expect(typeof rendered).toBe("string");
		expect(request).toHaveBeenCalled();
		for (const [path] of request.mock.calls) {
			const query = new URL(path, "https://feishu.invalid").searchParams;
			expect(query.get("container_id")).toBe("chat");
		}
		request.mockRestore();
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
