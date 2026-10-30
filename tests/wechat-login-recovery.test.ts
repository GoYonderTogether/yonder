import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

test("relogin wakes the expired retry timer and immediately polls with the new credential", async () => {
	const h = await setup({
		base: "https://ilinkai.weixin.qq.com",
		cursor: "cursor",
		peer: "peer",
		bot: "bot",
		token: "old",
		linked: true,
		contexts: {},
		seen: {},
	});
	const updates: string[] = [];
	const transport = vi.fn<typeof fetch>(async (input, init) => {
		const path = new URL(String(input)).pathname;
		if (path.endsWith("get_bot_qrcode")) return json({ qrcode: "q", qrcode_img_content: "https://example.invalid/qr" });
		if (path.endsWith("get_qrcode_status"))
			return json({ status: "confirmed", ilink_bot_id: "bot", ilink_user_id: "peer", bot_token: "new" });
		const auth = new Headers(init?.headers).get("Authorization") ?? "";
		updates.push(auth);
		return auth === "Bearer old" ? json({ errcode: -14 }) : json({ msgs: [], get_updates_buf: "cursor" });
	});
	const channel = new IlinkChannel("wx", {}, h.api, async () => undefined, { fetch: transport });
	try {
		await channel.start({ emit: async () => ({}), ask: async () => ({}) } as unknown as ChannelIO);
		await expect.poll(async () => ((await channel.status()) as { error: string }).error).toBe("ILINK_SESSION_EXPIRED");
		expect((await channel.login("poll", new AbortController().signal)).status).toBe("expired");
		await channel.login("start", new AbortController().signal);
		await channel.login("poll", new AbortController().signal);
		await expect.poll(() => updates.includes("Bearer new"), { timeout: 3000 }).toBe(true);
		expect(((await channel.status()) as { error: string | null }).error).toBeNull();
	} finally {
		await channel.stop();
		await h.done();
	}
});

test("relogin aborts an old in-flight poll before starting the new session", async () => {
	const h = await setup({
		base: "https://ilinkai.weixin.qq.com",
		cursor: "cursor",
		peer: "peer",
		bot: "bot",
		token: "old",
		linked: true,
		contexts: {},
		seen: {},
	});
	let oldStarted = false;
	let newStarted = false;
	let oldAborted = false;
	const transport = vi.fn<typeof fetch>(async (input, init) => {
		const path = new URL(String(input)).pathname;
		if (path.endsWith("get_bot_qrcode")) return json({ qrcode: "q", qrcode_img_content: "https://example.invalid/qr" });
		if (path.endsWith("get_qrcode_status"))
			return json({ status: "confirmed", ilink_bot_id: "bot", ilink_user_id: "peer", bot_token: "new" });
		if (new Headers(init?.headers).get("Authorization") === "Bearer old") {
			oldStarted = true;
			return new Promise<Response>((_resolve, reject) =>
				init?.signal?.addEventListener(
					"abort",
					() => {
						oldAborted = true;
						reject(new Error("aborted"));
					},
					{ once: true },
				),
			);
		}
		newStarted = true;
		return json({ msgs: [], get_updates_buf: "cursor" });
	});
	const channel = new IlinkChannel("wx", {}, h.api, async () => undefined, { fetch: transport });
	try {
		await channel.start({ emit: async () => ({}), ask: async () => ({}) } as unknown as ChannelIO);
		await expect.poll(() => oldStarted).toBe(true);
		await channel.login("start", new AbortController().signal);
		await channel.login("poll", new AbortController().signal);
		await expect.poll(() => newStarted, { timeout: 3000 }).toBe(true);
		expect(oldAborted).toBe(true);
		expect(((await channel.status()) as { error: string | null }).error).toBeNull();
	} finally {
		await channel.stop();
		await h.done();
	}
});

test("same peer may rotate bot and immediately resume with fresh cursor", async () => {
	const h = await setup({
		base: "https://ilinkai.weixin.qq.com",
		cursor: "old-cursor",
		peer: "peer",
		bot: "old-bot",
		token: "old",
		person: "person:owner",
		linked: true,
		contexts: { peer: "old-context" },
		seen: { "peer:old": "event" },
	});
	let newCursor: string | undefined;
	const transport = vi.fn<typeof fetch>(async (input, init) => {
		const path = new URL(String(input)).pathname;
		if (path.endsWith("get_bot_qrcode")) return json({ qrcode: "q", qrcode_img_content: "https://example.invalid/qr" });
		if (path.endsWith("get_qrcode_status"))
			return json({ status: "confirmed", ilink_bot_id: "new-bot", ilink_user_id: "peer", bot_token: "new" });
		if (new Headers(init?.headers).get("Authorization") === "Bearer new")
			newCursor = JSON.parse(String(init?.body)).get_updates_buf;
		return json({ msgs: [] });
	});
	const channel = new IlinkChannel("wx", {}, h.api, async () => undefined, { fetch: transport });
	try {
		await channel.start({ emit: async () => ({}), ask: async () => ({}) } as unknown as ChannelIO);
		await channel.login("start", new AbortController().signal);
		await channel.login("poll", new AbortController().signal);
		await expect.poll(() => newCursor, { timeout: 3000 }).toBe("");
		const state = JSON.parse(await readFile(join(h.directory, "wx/account.json"), "utf8"));
		expect(state).toMatchObject({
			peer: "peer",
			bot: "new-bot",
			token: "new",
			person: "person:owner",
			cursor: "",
			contexts: {},
			seen: { "peer:old": "event" },
			linked: true,
		});
	} finally {
		await channel.stop();
		await h.done();
	}
});

test("relogin does not persist an old page cursor while its message is being delivered", async () => {
	const h = await setup({
		base: "https://ilinkai.weixin.qq.com",
		cursor: "old",
		peer: "peer",
		bot: "old-bot",
		token: "old",
		linked: true,
		contexts: {},
		seen: {},
	});
	let release!: () => void;
	let delivering = false;
	const blocked = new Promise<void>((resolve) => {
		release = resolve;
	});
	let newCursor: string | undefined;
	const transport = vi.fn<typeof fetch>(async (input, init) => {
		const path = new URL(String(input)).pathname;
		if (path.endsWith("get_bot_qrcode")) return json({ qrcode: "q", qrcode_img_content: "https://example.invalid/qr" });
		if (path.endsWith("get_qrcode_status"))
			return json({ status: "confirmed", ilink_bot_id: "new-bot", ilink_user_id: "peer", bot_token: "new" });
		if (new Headers(init?.headers).get("Authorization") === "Bearer old")
			return json({
				msgs: [{ from_user_id: "peer", message_type: 1, message_id: "1", create_time_ms: 1 }],
				get_updates_buf: "stale",
			});
		newCursor = JSON.parse(String(init?.body)).get_updates_buf;
		return json({ msgs: [] });
	});
	const channel = new IlinkChannel("wx", {}, h.api, async () => undefined, { fetch: transport });
	try {
		await channel.start({
			emit: async () => {
				delivering = true;
				await blocked;
				return { id: "event" };
			},
		} as unknown as ChannelIO);
		await expect.poll(() => delivering).toBe(true);
		await channel.login("start", new AbortController().signal);
		await channel.login("poll", new AbortController().signal);
		release();
		await expect.poll(() => newCursor).toBe("");
		const state = JSON.parse(await readFile(join(h.directory, "wx/account.json"), "utf8"));
		expect(state.cursor).toBe("");
		expect(state.seen).toEqual({});
	} finally {
		release();
		await channel.stop();
		await h.done();
	}
});

test("different peer requires explicit replace and never inherits old owner", async () => {
	const original = {
		base: "https://ilinkai.weixin.qq.com",
		cursor: "old-cursor",
		peer: "old-peer",
		bot: "old-bot",
		token: "old",
		person: "person:owner",
		linked: true,
		contexts: { "old-peer": "old-context" },
		seen: { "old-peer:1": "event" },
	};
	const h = await setup(original);
	const transport = vi.fn<typeof fetch>(async (input) => {
		const path = new URL(String(input)).pathname;
		if (path.endsWith("get_bot_qrcode")) return json({ qrcode: "q", qrcode_img_content: "https://example.invalid/qr" });
		return json({ status: "confirmed", ilink_bot_id: "new-bot", ilink_user_id: "new-peer", bot_token: "new" });
	});
	const channel = new IlinkChannel("wx", {}, h.api, async () => "person:owner", { fetch: transport });
	try {
		await channel.login("start", new AbortController().signal);
		await expect(channel.login("poll", new AbortController().signal)).rejects.toThrow(
			"微信账号与现有绑定不同；确认要更换请使用 yonder channels login wx --replace",
		);
		expect(JSON.parse(await readFile(join(h.directory, "wx/account.json"), "utf8"))).toEqual(original);
		await channel.login("start", new AbortController().signal, undefined, true);
		await expect
			.poll(
				async () =>
					((await channel.status()) as { peer: string; paired: boolean }).paired
						? ((await channel.status()) as { peer: string }).peer
						: undefined,
				{ timeout: 4000 },
			)
			.toBe("new-peer");
		const state = JSON.parse(await readFile(join(h.directory, "wx/account.json"), "utf8"));
		expect(state).toMatchObject({
			peer: "new-peer",
			bot: "new-bot",
			token: "new",
			person: null,
			linked: true,
			cursor: "",
			contexts: {},
			seen: {},
		});
	} finally {
		await channel.stop();
		await h.done();
	}
});
