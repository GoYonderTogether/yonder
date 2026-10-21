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
import { incoming, recipient } from "../src/channel.js";
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
		expect(input?.conv).toBe(kind === "dm" ? "conv:qq-main:c2c:USER" : "conv:qq-main:group:GROUP");
		expect(recipient("qq-main", String(input?.conv))).toEqual(msg.replyTarget);
		expect(
			incoming("qq-main", { appId: "1", credential: "qq", allowedUsers: [], allowedGroups: [] }, msg),
		).toBeUndefined();
		expect(incoming("qq-main", { appId: "1", credential: "qq" }, { ...msg, senderIsBot: true })).toBeUndefined();
		if (kind === "group")
			expect(
				incoming("qq-main", { appId: "1", credential: "qq" }, { ...msg, rawEventType: "GROUP_MESSAGE_CREATE" }),
			).toBeUndefined();
	}
	expect(() => recipient("qq-work", "conv:qq-main:c2c:USER")).toThrow("another instance");
	expect(() => recipient("qq-main", "conv:qq-main:USER")).toThrow("c2c:");
	expect(() => recipient("qq-main", "acct:qq-main:../messages")).toThrow("Invalid QQ OpenID");
});

test("scan completion configures an isolated real home, preserves other credentials and keeps groups without tools", async () => {
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
		const agent = parse(await readFile(join(home, "agents/main/agent.yaml"), "utf8"));
		expect(agent.profiles["qq-main-group"]).toMatchObject({
			capabilities: [],
			tools: { offer: [] },
			plugins: [],
			contexts: [],
			skills: [],
		});
		expect(agent.bindings[0].match.from).toBe("acct:qq-main:OWNER");
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
