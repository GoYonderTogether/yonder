import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dispatchEvent, MediaFileType, type QQBotInboundMessage } from "@tencent-connect/qqbot-nodejs/protocol";
import { checkPlugin, type PluginAPI } from "@yonder/sdk/testing";
import { expect, test } from "vitest";
import { parse, stringify } from "yaml";
import { testModel } from "../../../packages/core/src/config/test-support.js";
import { initHome, inspectHome } from "../../../packages/core/src/kernel/home.js";
import {
	assertInsideMediaRoot,
	droppedAttachments,
	incoming,
	mediaOf,
	QQChannel,
	quoteOf,
	recipient,
	Spacing,
} from "../src/channel.js";
import { groupInstructions, groupTools, legacyGroupInstructions } from "../src/participation.js";
import { configure, connect, upgradeGroups } from "../src/setup.js";

test("cancelled QR setup does not contact the portal", async () => {
	await expect(
		connect(() => {
			throw new Error("Unexpected QR link");
		}, AbortSignal.abort()),
	).rejects.toThrow();
});

test("QQ plugin satisfies the SDK contract", async () => {
	expect(await checkPlugin(fileURLToPath(new URL("..", import.meta.url)))).toEqual([]);
});

test("QQ protocol events preserve reply identity and separate DM, group @, full-group and other instances", () => {
	// Protocol-only inputs exercise the real Tencent parser; no model or SDK is replaced.
	for (const [event, kind] of [
		["C2C_MESSAGE_CREATE", "dm"],
		["GROUP_AT_MESSAGE_CREATE", "group"],
		["GROUP_MESSAGE_CREATE", "group"],
	] as const) {
		const raw = {
			id: randomBytes(16).toString("hex"),
			content: "验收消息",
			author: { user_openid: "USER", member_openid: "MEMBER" },
			group_openid: "GROUP",
			timestamp: new Date().toISOString(),
		};
		const result = dispatchEvent(event, raw, "instance");
		if (result.action !== "message") throw new Error("Tencent SDK did not parse the protocol event");
		const msg = {
			...result.msg,
			replyTarget: {
				scope: kind === "dm" ? ("c2c" as const) : ("group" as const),
				targetId: kind === "dm" ? "USER" : "GROUP",
			},
		};
		const input = incoming("qq-main", { appId: "1", credential: "qq" }, msg);
		expect(input?.data).toMatchObject({ kind, text: raw.content, msgId: raw.id });
		if (kind === "group") {
			expect(input?.data.mentioned).toBe(event === "GROUP_AT_MESSAGE_CREATE");
			expect(input?.data.social).toEqual({ mentions: { bot: event === "GROUP_AT_MESSAGE_CREATE" }, nativeKind: event });
			expect(
				incoming("qq-main", { appId: "1", credential: "qq" }, { ...msg, mentions: [{ is_you: true }] })?.data.mentioned,
			).toBe(true);
		}
		expect(input?.conv).toBe(kind === "dm" ? "conv:qq-main:c2c:USER" : "conv:qq-main:group:GROUP");
		expect(recipient("qq-main", String(input?.conv))).toEqual(msg.replyTarget);
		expect(
			incoming("qq-main", { appId: "1", credential: "qq", allowedUsers: [], allowedGroups: [] }, msg),
		).toBeUndefined();
		expect(incoming("qq-main", { appId: "1", credential: "qq" }, { ...msg, senderIsBot: true })).toBeUndefined();
		if (kind === "group")
			expect(
				incoming("qq-main", { appId: "1", credential: "qq" }, { ...msg, rawEventType: "MESSAGE_CREATE" }),
			).toBeUndefined();
	}
	expect(() => recipient("qq-work", "conv:qq-main:c2c:USER")).toThrow("another instance");
	expect(() => recipient("qq-main", "conv:qq-main:USER")).toThrow("c2c:");
	expect(() => recipient("qq-main", "acct:qq-main:../messages")).toThrow("Invalid QQ OpenID");
});

test("scan completion preserves credentials and configures read-only group participation through bindings", async () => {
	const home = await mkdtemp(join(tmpdir(), "yonder-qq-config-"));
	try {
		await initHome(home, "owner", { model: testModel });
		const options = { home, agent: "main", instance: "qq-main" };
		const authFile = join(home, ".yonder/auth.json");
		await mkdir(join(home, ".yonder"), { recursive: true });
		const before = randomBytes(32).toString("hex");
		await writeFile(authFile, JSON.stringify({ existing: { type: "api_key", key: before } }), { mode: 0o600 });
		const secret = randomBytes(32).toString("hex");
		const result = await configure(options, { appId: "123", appSecret: secret, userOpenid: "OWNER" });
		expect(JSON.stringify(result)).not.toContain(secret);
		const auth = JSON.parse(await readFile(authFile, "utf8"));
		expect(auth.existing.key).toBe(before);
		expect(auth["qq-qq-main"].key).toBe(secret);
		// Windows does not expose POSIX permission bits.
		if (process.platform !== "win32") expect((await stat(authFile)).mode & 0o777).toBe(0o600);
		const config = parse(await readFile(join(home, "yonder.yaml"), "utf8"));
		expect(JSON.stringify(config)).not.toContain(secret);
		expect(config.channels["qq-main"].allowedUsers).toEqual(["OWNER"]);
		expect(config.channels["qq-main"].groupWindowSeconds).toBe(60);
		const agent = parse(await readFile(join(home, "agents/main/agent.yaml"), "utf8"));
		expect(agent.profiles["qq-main-group"]).toMatchObject({
			capabilities: ["read"],
			tools: { offer: groupTools },
			contexts: ["peer-workspace"],
			plugins: [],
			skills: [],
		});
		expect(agent.bindings[0].match.from).toBe("acct:qq-main:OWNER");
		expect(agent.bindings[0].busy).toBe("steer");
		expect(agent.bindings[1]).toMatchObject({ wake: "write", reply: "none" });
		expect(agent.bindings[2]).toMatchObject({
			match: { type: "channel-qq.group-batch" },
			reply: "none",
			profile: "qq-main-group",
			busy: "steer",
		});
		expect(agent.bindings[3]).toMatchObject({ match: { kind: "parent-request" }, session: "main", reply: "none" });
		expect((await inspectHome(home)).errors).toEqual([]);
		const saved = await readFile(authFile, "utf8");
		await expect(configure({ ...options, instance: "qq-second" }, { appId: "456", appSecret: secret })).rejects.toThrow(
			"scanner OpenID",
		);
		expect(await readFile(authFile, "utf8")).toBe(saved);
		await expect(configure(options, { appId: "123", appSecret: secret, userOpenid: "OWNER" })).rejects.toThrow(
			"already exists",
		);
		expect(await readFile(authFile, "utf8")).toBe(saved);
		// Invalid profile is rejected before writing credentials or a channel.
		await expect(
			configure(
				{ ...options, instance: "qq-second", profile: "missing" },
				{ appId: "123", appSecret: secret, userOpenid: "OWNER" },
			),
		).rejects.toThrow("existing private-chat");
		expect(await readFile(authFile, "utf8")).toBe(saved);
		config.channels["qq-second"] = { type: "qq", appId: "123", credential: "qq-qq-main", allowedUsers: [] };
		await writeFile(join(home, "yonder.yaml"), stringify(config));
		expect((await inspectHome(home)).errors).toEqual([]);
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});

test("inbound media and quoted replies keep the real protocol structure", () => {
	const raw = {
		id: randomBytes(16).toString("hex"),
		content: "",
		author: { user_openid: "USER" },
		timestamp: new Date().toISOString(),
		attachments: [
			{ content_type: "image/png", url: "https://gchat.qpic.cn/a.png", filename: "截图.png", size: 2048 },
			{ content_type: "application/pdf", url: "http://insecure.example/b.pdf" },
		],
	};
	const result = dispatchEvent("C2C_MESSAGE_CREATE", raw, "instance");
	if (result.action !== "message") throw new Error("Tencent SDK did not parse the protocol event");
	const msg = { ...result.msg, replyTarget: { scope: "c2c" as const, targetId: "USER" } };
	const input = incoming("qq-main", { appId: "1", credential: "qq" }, msg);
	expect(input?.data).toMatchObject({
		kind: "dm",
		text: "",
		attachments: [
			{ kind: "image", mime: "image/png", uri: "https://gchat.qpic.cn/a.png", name: "截图.png", bytes: 2048 },
		],
	});
	expect(
		incoming(
			"qq-main",
			{ appId: "1", credential: "qq" },
			{
				...msg,
				attachments: [{ content_type: "image/png", url: "file:///etc/passwd" }],
			},
		),
	).toBeUndefined();
	const quoted = dispatchEvent(
		"GROUP_AT_MESSAGE_CREATE",
		{
			id: randomBytes(16).toString("hex"),
			content: "接上文",
			author: { member_openid: "MEMBER" },
			group_openid: "GROUP",
			timestamp: new Date().toISOString(),
			message_type: 103,
			message_scene: { ext: ["ref_msg_idx=REF1", "msg_idx=SELF1"] },
			msg_elements: [{ msg_idx: "REF1", content: "被引用的原文" }],
		},
		"instance",
	);
	if (quoted.action !== "message") throw new Error("Tencent SDK did not parse the quoted reply");
	const reply = incoming(
		"qq-main",
		{ appId: "1", credential: "qq" },
		{
			...quoted.msg,
			replyTarget: { scope: "group" as const, targetId: "GROUP" },
		},
	);
	expect(reply?.data).toMatchObject({ kind: "group", mentioned: true, quote: { text: "被引用的原文" } });
	expect(reply?.conv).toBe("conv:qq-main:group:GROUP");
});

test("send spacing serializes requests and keeps the configured interval", async () => {
	const spacing = new Spacing(40);
	const at: number[] = [];
	let active = 0;
	let peak = 0;
	const start = Date.now();
	await Promise.all(
		[0, 1, 2].map(() =>
			spacing.run(async () => {
				active++;
				peak = Math.max(peak, active);
				at.push(Date.now() - start);
				await new Promise((done) => setTimeout(done, 5));
				active--;
			}),
		),
	);
	expect(peak).toBe(1);
	const [first = 0, second = 0, third = 0] = at;
	expect(second - first).toBeGreaterThanOrEqual(30);
	expect(third - second).toBeGreaterThanOrEqual(30);
});

test("quoted replies are dropped without a reference index", () => {
	expect(quoteOf({ msgElements: [{ content: "原文" }] } as QQBotInboundMessage)).toBeUndefined();
	expect(quoteOf({ refMsgIdx: "REF1", msgElements: [{ content: "原文" }] } as QQBotInboundMessage)).toEqual({
		text: "原文",
	});
});

test("outbound local media is restricted to the allowlisted root", async () => {
	const home = await mkdtemp(join(tmpdir(), "yonder-qq-media-"));
	try {
		const root = join(home, "media");
		await mkdir(root, { recursive: true });
		await writeFile(join(root, "a.png"), "png");
		await symlink("a.png", join(root, "inside.png"));
		const outside = join(home, "outside.png");
		await writeFile(outside, "png");
		await symlink(outside, join(root, "escape.png"));
		const image = { kind: "image" as const, mime: "image/png" };
		expect(mediaOf({ ...image, uri: "https://gchat.qpic.cn/a.png" }, root)).toEqual({
			ok: true,
			media: { fileType: MediaFileType.IMAGE, source: { url: "https://gchat.qpic.cn/a.png" } },
		});
		expect(mediaOf({ ...image, uri: join(root, "a.png") }, root)).toEqual({
			ok: true,
			media: { fileType: MediaFileType.IMAGE, source: { localPath: join(root, "a.png") } },
		});
		// file: 引用、~/ 和相对 home 的路径都先解析成绝对路径，再按白名单判定。
		expect(mediaOf({ ...image, uri: pathToFileURL(join(root, "a.png")).href }, root)).toMatchObject({
			ok: true,
			media: { source: { localPath: join(root, "a.png") } },
		});
		expect(mediaOf({ ...image, uri: "~/media/a.png" }, root, home)).toMatchObject({
			ok: true,
			media: { source: { localPath: join(root, "a.png") } },
		});
		expect(mediaOf({ ...image, uri: "../a.png" }, root, join(root, "nested"))).toMatchObject({
			ok: true,
			media: { source: { localPath: join(root, "a.png") } },
		});
		// 解析不了或不在白名单的附件返回原因，不抛错。
		expect(mediaOf({ ...image, uri: join(home, "outside.png") }, root)).toMatchObject({
			ok: false,
			reason: expect.stringContaining("不在允许的目录"),
		});
		expect(mediaOf({ ...image, uri: "http://example.com/a.png" }, root)).toMatchObject({
			ok: false,
			reason: expect.stringContaining("只支持 https"),
		});
		await expect(assertInsideMediaRoot(join(root, "inside.png"), root)).resolves.toBeUndefined();
		await expect(assertInsideMediaRoot(join(root, "escape.png"), root)).rejects.toThrow(
			"escapes the allowlisted media root",
		);
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});

function testChannel(home: string, bot: unknown): QQChannel {
	const api = {
		paths: { data: home },
		log: { info() {}, warn() {}, error() {} },
		credentials: { get: async () => ({ type: "api_key", key: "secret" }) },
	} as unknown as PluginAPI;
	const channel = new QQChannel("qq-main", { appId: "1", credential: "qq" }, api);
	const internals = channel as unknown as { bot: unknown; state: string };
	internals.bot = bot;
	internals.state = "ready";
	return channel;
}

test("an unresolvable attachment is skipped with a readable warning while the text still goes out", async () => {
	const home = await mkdtemp(join(tmpdir(), "yonder-qq-skip-"));
	try {
		const root = join(home, "qq-main", "media");
		await mkdir(root, { recursive: true });
		const file = join(root, "a.png");
		await writeFile(file, "png");
		const calls: Array<[string, unknown]> = [];
		const warnings: Array<{ msg: string; data?: object }> = [];
		const channel = testChannel(home, {
			send: async (request: unknown) => {
				calls.push(["text", request]);
				return { id: "TEXT1" };
			},
			sendMedia: async (request: unknown) => {
				calls.push(["media", request]);
				return { message: { id: "MEDIA1" } };
			},
		});
		(channel as unknown as { api: { log: { warn(msg: string, data?: object): void } } }).api.log.warn = (msg, data) =>
			warnings.push({ msg, data });
		const media = { kind: "image" as const, mime: "image/png" };
		// 一条 file: 引用（可发）、一条 http 链接（发不了）：正文和可发的附件都要出去。
		const result = await channel.send("conv:qq-main:c2c:USER", {
			text: "看这张图",
			attachments: [
				{ ...media, uri: pathToFileURL(file).href },
				{ ...media, uri: "http://example.com/b.png", name: "b.png" },
			],
		});
		expect(result).toEqual({ ok: true, id: "TEXT1" });
		expect(calls.map(([kind]) => kind)).toEqual(["text", "media"]);
		expect(calls[1]?.[1]).toMatchObject({ localPath: file });
		expect(warnings[0]?.msg).toContain("skipped");
		expect(warnings[0]?.data).toMatchObject({
			instance: "qq-main",
			allowedRoot: root,
			skipped: [expect.stringContaining("只支持 https")],
		});
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});

test("a textless reply whose every attachment is skipped fails with the reason instead of sending nothing", async () => {
	const home = await mkdtemp(join(tmpdir(), "yonder-qq-empty-"));
	try {
		const calls: string[] = [];
		const channel = testChannel(home, {
			send: async () => {
				calls.push("text");
				return { id: "TEXT1" };
			},
			sendMedia: async () => {
				calls.push("media");
				return { message: { id: "MEDIA1" } };
			},
		});
		// 正文为空、唯一附件又解析不了：不能悄悄发一条空消息，跳过原因要交回去。
		const result = await channel.send("conv:qq-main:c2c:USER", {
			text: "   ",
			attachments: [{ kind: "file", mime: "application/pdf", uri: "http://example.com/a.pdf", name: "a.pdf" }],
		});
		expect(result).toMatchObject({
			ok: false,
			error: expect.stringContaining("a.pdf：只支持 https 链接：http://example.com/a.pdf"),
		});
		expect(calls).toEqual([]);
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});

test("sendMedia uploads allowlisted local files; a partial failure never resends the text", async () => {
	const home = await mkdtemp(join(tmpdir(), "yonder-qq-send-"));
	try {
		const root = join(home, "qq-main", "media");
		await mkdir(root, { recursive: true });
		const file = join(root, "a.png");
		await writeFile(file, "png");
		const calls: Array<[string, unknown]> = [];
		let mediaCalls = 0;
		const bot = {
			send: async (request: unknown) => {
				calls.push(["text", request]);
				return { id: "TEXT1" };
			},
			sendMedia: async (request: unknown) => {
				calls.push(["media", request]);
				mediaCalls++;
				if (mediaCalls === 1) return { message: { id: "MEDIA1" } };
				throw new Error("upload boom");
			},
		};
		const channel = testChannel(home, bot);
		const media = { kind: "image" as const, mime: "image/png" };
		const local = await channel.send("conv:qq-main:c2c:USER", {
			text: "",
			attachments: [{ ...media, uri: file }],
		});
		expect(local).toEqual({ ok: true, id: "MEDIA1" });
		expect(calls[0]).toEqual([
			"media",
			{ target: { scope: "c2c", targetId: "USER" }, fileType: MediaFileType.IMAGE, localPath: file },
		]);
		// Text accepted, first media accepted, second media fails: unknown, not a resend.
		calls.length = 0;
		mediaCalls = 0;
		const partial = await channel.send("conv:qq-main:c2c:USER", {
			text: "你好",
			attachments: [
				{ ...media, uri: "https://gchat.qpic.cn/a.png" },
				{ ...media, uri: file },
			],
		});
		expect(partial).toEqual({
			ok: false,
			uncertain: true,
			id: "TEXT1",
			error: expect.stringContaining("2/3 accepted"),
		});
		expect(calls.filter(([kind]) => kind === "text")).toHaveLength(1);
		// Text accepted without an id still counts as success.
		calls.length = 0;
		mediaCalls = 0;
		const noId = await channel.send("conv:qq-main:c2c:USER", {
			text: "你好",
			attachments: [{ ...media, uri: "https://gchat.qpic.cn/a.png" }],
		});
		expect(noId).toEqual({ ok: true, id: "TEXT1" });
		const plain = await testChannel(home, {
			send: async () => ({}),
			sendMedia: async () => ({ message: {} }),
		}).send("conv:qq-main:c2c:USER", { text: "你好" });
		expect(plain).toEqual({ ok: true });
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});

test("non-https inbound attachments are dropped with a warning", () => {
	const raw = {
		id: randomBytes(16).toString("hex"),
		content: "",
		author: { user_openid: "USER" },
		timestamp: new Date().toISOString(),
		attachments: [
			{ content_type: "image/png", url: "https://gchat.qpic.cn/a.png" },
			{ content_type: "image/png", url: "http://insecure.example/b.png" },
			{ content_type: "image/png", url: "file:///etc/passwd" },
		],
	};
	const result = dispatchEvent("C2C_MESSAGE_CREATE", raw, "instance");
	if (result.action !== "message") throw new Error("Tencent SDK did not parse the protocol event");
	const msg = { ...result.msg, replyTarget: { scope: "c2c" as const, targetId: "USER" } };
	const event = incoming("qq-main", { appId: "1", credential: "qq" }, msg);
	if (!event) throw new Error("message with only attachments must still be accepted");
	expect(droppedAttachments(msg, event)).toBe(2);
});

test("official group upgrade preserves custom prompts and creates a recoverable backup", async () => {
	const home = await mkdtemp(join(tmpdir(), "yonder-qq-upgrade-"));
	try {
		await initHome(home, "owner", { model: testModel });
		const file = join(home, "agents/main/agent.yaml");
		const doc = parse(await readFile(file, "utf8"));
		doc.profiles.official = {
			capabilities: ["read"],
			instructions: legacyGroupInstructions,
			contexts: ["existing-context"],
			tools: { offer: ["read", "grep", "message_send", "parent_ask"], search: [] },
		};
		doc.profiles.custom = { instructions: "Custom group instructions", tools: { offer: ["read"] } };
		const before = stringify(doc);
		await writeFile(file, before);
		expect((await upgradeGroups(home, "main")).changed).toEqual([file]);
		const updated = parse(await readFile(file, "utf8"));
		expect(updated.profiles.official.instructions).toBe(groupInstructions);
		expect(updated.profiles.official.contexts).toEqual(["existing-context", "peer-workspace"]);
		expect(updated.profiles.official.tools.offer.toSorted()).toEqual(groupTools.toSorted());
		expect(updated.profiles.custom).toEqual(doc.profiles.custom);
		expect((await upgradeGroups(home, "main")).changed).toEqual([]);
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});

test("QQ ingress retains explicit mention identities and reference indices without inferring unknown targets", () => {
	const result = dispatchEvent(
		"GROUP_MESSAGE_CREATE",
		{
			id: "received",
			content: "需求",
			timestamp: new Date().toISOString(),
			author: { member_openid: "OWNER" },
			group_openid: "GROUP",
		},
		"instance",
	);
	if (result.action !== "message") throw new Error("Tencent parser rejected input");
	const input = incoming(
		"qq-main",
		{ appId: "1", credential: "qq" },
		{
			...result.msg,
			replyTarget: { scope: "group", targetId: "GROUP" },
			msgIdx: "REFIDX-current",
			refMsgIdx: "REFIDX-quoted",
			mentions: [
				{ member_openid: "OWNER", nickname: "owner" },
				{ scope: "all" },
				{ is_you: true },
				{ id: "invalid id" },
			],
		},
	);
	expect(input?.data).toMatchObject({
		mentions: ["acct:qq-main:OWNER"],
		qq: { msgIdx: "REFIDX-current", refMsgIdx: "REFIDX-quoted" },
	});
});

test("QQ rejects unverified outbound mentions before making a platform request", async () => {
	const home = await mkdtemp(join(tmpdir(), "yonder-qq-mention-"));
	try {
		const channel = testChannel(home, {
			send: async () => {
				throw new Error("Must not send");
			},
		});
		expect(channel.features.outboundMentions).toBe(false);
		expect(
			await channel.send("conv:qq-main:group:GROUP", { text: "需求", mentions: ["acct:qq-main:OWNER"] }),
		).toMatchObject({ ok: false, error: expect.stringContaining("未发送") });
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});

test("QQ transport source stays unquoted unless replyTo selects a visible reference", async () => {
	const home = await mkdtemp(join(tmpdir(), "yonder-qq-reference-"));
	try {
		const sent: unknown[] = [];
		const channel = testChannel(home, {
			send: async (request: unknown) => {
				sent.push(request);
				return { id: "accepted" };
			},
		});
		(channel as unknown as { api: { events: { query(): Promise<unknown> } } }).api.events = {
			query: async () => ({ events: [{ data: { msgId: "native-message", qq: { msgIdx: "REFIDX-current" } } }] }),
		};
		expect(
			await channel.send("conv:qq-main:group:GROUP", { text: "普通发言", sourceMessageId: "native-message" }),
		).toMatchObject({ ok: true });
		expect(sent[0]).toMatchObject({ target: { msgId: "native-message" }, content: "普通发言" });
		expect(sent[0]).not.toHaveProperty("messageReference");
		expect(
			await channel.send("conv:qq-main:group:GROUP", { text: "引用发言", replyTo: "native-message" }),
		).toMatchObject({ ok: true });
		expect(sent[1]).toMatchObject({
			target: { msgId: "native-message" },
			messageReference: { message_id: "REFIDX-current" },
		});
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});
