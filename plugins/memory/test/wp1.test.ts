import { mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PluginAPI, ToolContext } from "@yonder/sdk";
import { checkPlugin, createRegistrationCollector } from "@yonder/sdk/testing";
import { afterEach, expect, it } from "vitest";
import { validateConfig } from "../src/config.js";
import plugin from "../src/index.js";

const temps: string[] = [];
async function temp() {
	const p = await mkdtemp(join(tmpdir(), "memory-wp1-"));
	temps.push(p);
	return p;
}
afterEach(async () => {
	await Promise.all(temps.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});
export function context(capabilities: ToolContext["capabilities"] = ["read", "write", "admin"]): ToolContext {
	return {
		agent: "main",
		profile: "test",
		session: "test-session",
		capabilities,
		signal: new AbortController().signal,
	} as ToolContext;
}
export async function setup(root: string, extra = {}) {
	const { api, registrations } = createRegistrationCollector();
	await plugin.setup({ ...api, config: { root, owner: "person:test", timezone: "UTC", ...extra } } as PluginAPI);
	return registrations;
}
it("passes checkPlugin and setup has no filesystem side effects", async () => {
	expect(await checkPlugin(fileURLToPath(new URL("..", import.meta.url)))).toEqual([]);
	const root = await temp();
	await setup(root);
	expect(await readdir(root)).toEqual([]);
});
it("initializes only on start and preserves every existing file byte on restart", async () => {
	const root = await temp();
	await writeFile(join(root, "SCHEMA.md"), "用户改写\r\n");
	const r = await setup(root);
	await r.triggers[0]!.start({
		emit: async () => {
			return {} as import("@yonder/sdk").YEvent;
		},
	});
	expect(await readFile(join(root, "SCHEMA.md"), "utf8")).toBe("用户改写\r\n");
	await writeFile(join(root, "me/now.md"), "当前手记\n");
	await r.triggers[0]!.start({
		emit: async () => {
			return {} as import("@yonder/sdk").YEvent;
		},
	});
	expect(await readFile(join(root, "me/now.md"), "utf8")).toBe("当前手记\n");
	await r.triggers[0]!.stop();
	expect(await readdir(root)).toEqual(expect.arrayContaining(["mine", "timeline", "raw", ".memory", "SCHEMA.md"]));
});
it("rejects equality, both containment directions, and symlink aliases before initialization", async () => {
	const base = await temp();
	const root = join(base, "memory");
	for (const path of [root, join(root, "child"), base]) {
		await expect(setup(root, { roots: [{ name: "notes", path }] })).rejects.toThrow("roots[0].path");
	}
	await symlink(base, join(base, "alias"));
	await expect(setup(root, { roots: [{ name: "notes", path: join(base, "alias/memory") }] })).rejects.toThrow(
		"overlaps root",
	);
	expect(await readdir(base)).toEqual(["alias"]);
});
it("validates every nested configuration field and reports field errors", async () => {
	const root = await temp();
	for (const extra of [
		{ timezone: "wrong" },
		{ root: "relative" },
		{ owner: "acct:x" },
		{ converter: { command: "relative" } },
		{ capture: { inlineMax: 0 } },
		{ bootstrap: { wechatStaleHours: -1 } },
		{ inbox: { rescanSeconds: 0 } },
		{ context: { meChars: 0 } },
		{ sources: { wechat: { unknown: true } } },
		{ roots: [{ name: "n", path: root, origin: "bad" }] },
	])
		expect(() => validateConfig({ root, owner: "person:test", timezone: "UTC", ...extra })).toThrow();
	expect(
		validateConfig({
			root,
			owner: "person:test",
			timezone: "UTC",
			capture: { channels: [], attachments: false, maxAttachmentBytes: 3, inlineMax: 5 },
			sources: { wechat: { cliPath: "/tmp/cli", chats: [{ chat: "Msg_1", self: true }] } },
			bootstrap: {
				wechatStaleHours: 24,
				checkMinutes: 60,
				cooldownHours: 24,
				inboxFiles: 20,
				unorganized: 100,
				staleDays: 7,
				model: "openai/gpt-6-luna",
			},
			inbox: { rescanSeconds: 60 },
			converter: { command: "/tmp/converter", args: [], timeoutSeconds: 120 },
			context: { meChars: 2000 },
		}).root,
	).toBe(root);
});
it("status returns readiness and counts without private content; denies missing capabilities", async () => {
	const root = await temp(),
		source = await temp();
	const r = await setup(root, { roots: [{ name: "notes", path: source }] });
	await r.triggers[0]!.start({
		emit: async () => {
			return {} as import("@yonder/sdk").YEvent;
		},
	});
	await writeFile(join(root, "inbox/a.txt"), "一段资料");
	await writeFile(
		join(root, "timeline/private.md"),
		"---\nprivate: true\n---\n- [ ] 12:00 {capture} 秘密 ^m12345678ab\n",
	);
	await r.triggers[0]!.stop();
	const result = await r.tools[0]!.execute({}, context());
	const value = JSON.parse(result.text);
	expect(value).toMatchObject({
		externalContent: true,
		inbox: 1,
		unorganized: 0,
		sources: [{ available: true }],
		rg: { available: true },
	});
	expect(result.text).not.toContain("秘密");
	expect((await r.tools[0]!.execute({}, context(["read"]))).isError).toBe(true);
});
