import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ChannelIO, PluginAPI } from "@yonder/sdk";
import { expect, test, vi } from "vitest";
import { IlinkChannel } from "../plugins/channel-wechat-ilink/src/channel.js";

// Mock transport only; no network, live account or model.
const json = (value: unknown) => new Response(JSON.stringify(value));
async function setup(saved?: object) {
	const directory = await mkdtemp("/tmp/yonder-ilink-recovery-test-");
	if (saved) {
		await mkdir(join(directory, "wx"));
		await writeFile(join(directory, "wx/account.json"), JSON.stringify(saved));
	}
	const warn = vi.fn();
	const api = {
		paths: { data: directory },
		credentials: { get: async () => undefined },
		log: { warn },
		identity: {
			person: async () => ({ id: "person:owner" }),
			account: async () => undefined,
			link: async () => {},
		},
	} as unknown as PluginAPI;
	return { directory, warn, api, done: () => rm(directory, { recursive: true, force: true }) };
}

test("login polling survives a transient error and still confirms the scan", async () => {
	const h = await setup();
	let statusCalls = 0;
	const transport = vi.fn<typeof fetch>(async (input) => {
		const path = new URL(String(input)).pathname;
		if (path.endsWith("get_bot_qrcode")) return json({ qrcode: "q", qrcode_img_content: "https://example.invalid/qr" });
		statusCalls++;
		if (statusCalls === 1) throw new Error("socket hang up");
		return json({ status: "confirmed", ilink_bot_id: "bot", ilink_user_id: "peer", bot_token: "tok" });
	});
	const channel = new IlinkChannel("wx", {}, h.api, async () => "person:owner", { fetch: transport });
	try {
		await channel.login("start", new AbortController().signal);
		await expect
			.poll(async () => ((await channel.status()) as { paired: boolean }).paired, { timeout: 8000 })
			.toBe(true);
		expect(statusCalls).toBe(2);
		expect(h.warn).toHaveBeenCalledWith("iLink login polling failed", expect.objectContaining({ retry: true }));
	} finally {
		await channel.stop();
		await h.done();
	}
});

test("a server-side session timeout is logged once and shown as expired", async () => {
	const h = await setup({
		base: "https://ilinkai.weixin.qq.com",
		cursor: "",
		peer: "peer",
		bot: "bot",
		token: "tok",
		linked: true,
		contexts: {},
		seen: {},
	});
	const transport = vi.fn<typeof fetch>(async () => json({ errcode: -14, errmsg: "session timeout" }));
	const channel = new IlinkChannel("wx", {}, h.api, async () => "person:owner", { fetch: transport });
	try {
		await channel.start({ emit: async () => ({}), ask: async () => ({}) } as unknown as ChannelIO);
		await expect
			.poll(async () => ((await channel.status()) as { error: string | null }).error, { timeout: 4000 })
			.toBe("ILINK_SESSION_EXPIRED");
		expect(h.warn).toHaveBeenCalledTimes(1);
		expect(h.warn.mock.calls[0]?.[0]).toContain("yonder channels login");
	} finally {
		await channel.stop();
		await h.done();
	}
});
