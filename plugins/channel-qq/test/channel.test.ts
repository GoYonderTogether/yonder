import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dispatchEvent } from "@tencent-connect/qqbot-nodejs/protocol";
import { checkPlugin } from "@yonder/sdk/testing";
import { expect, test } from "vitest";
import { parse, stringify } from "yaml";
import { initHome, inspectHome } from "../../../packages/core/src/kernel/home.js";
import { incoming, recipient, Spacing } from "../src/channel.js";
import { configure, connect } from "../src/setup.js";

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
		await initHome(home);
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
		expect((await stat(authFile)).mode & 0o777).toBe(0o600);
		const config = parse(await readFile(join(home, "yonder.yaml"), "utf8"));
		expect(JSON.stringify(config)).not.toContain(secret);
		expect(config.channels["qq-main"].allowedUsers).toEqual(["OWNER"]);
		expect(config.channels["qq-main"].groupWindowSeconds).toBe(60);
		const agent = parse(await readFile(join(home, "agents/main/agent.yaml"), "utf8"));
		expect(agent.profiles["qq-main-group"]).toMatchObject({
			capabilities: ["read"],
			tools: { offer: ["read", "grep", "message_send", "parent_ask"] },
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
	expect(incoming("qq-main", { appId: "1", credential: "qq" }, {
		...msg,
		attachments: [{ content_type: "image/png", url: "file:///etc/passwd" }],
	})).toBeUndefined();
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
	const reply = incoming("qq-main", { appId: "1", credential: "qq" }, {
		...quoted.msg,
		replyTarget: { scope: "group" as const, targetId: "GROUP" },
	});
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
