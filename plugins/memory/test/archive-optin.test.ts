import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginAPI } from "@yonder/sdk";
import { createRegistrationCollector } from "@yonder/sdk/testing";
import { afterEach, expect, it } from "vitest";
import { initialize } from "../src/files.js";
import plugin from "../src/index.js";
import { event } from "./harness.js";

const roots: string[] = [];
afterEach(async () => {
	await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function setup(capture?: { enabled?: boolean }) {
	const base = await mkdtemp(join(tmpdir(), "memory-archive-optin-"));
	const root = join(base, "root");
	roots.push(base);
	const { api, registrations } = createRegistrationCollector();
	await plugin.setup({
		...api,
		config: {
			root,
			owner: "person:test",
			timezone: "UTC",
			...(capture === undefined ? {} : { capture }),
			sources: { wechat: { chats: [{ chat: "allowed-chat", self: true }] } },
		},
	} as PluginAPI);
	return { root, registrations };
}
const material = (from: string, chat = "allowed-chat") =>
	event("wechat-archive.material", from, {
		chat,
		messages: [{ id: 1, chat, timestamp: 1700000000, text: "synthetic archive message" }],
	});

it.each([undefined, { enabled: false }])(
	"does not subscribe to or persist automatic archive material when capture is %s",
	async (capture) => {
		const h = await setup(capture);
		expect(h.registrations.listeners.some((listener) => listener.type === "wechat-archive.material")).toBe(false);
		expect(await readdir(h.root).catch(() => [])).toEqual([]);
	},
);

it("subscribes only with explicit opt-in and accepts only archive-origin material for an allowlisted chat", async () => {
	const h = await setup({ enabled: true });
	const listener = h.registrations.listeners.find((entry) => entry.type === "wechat-archive.material");
	if (!listener) throw new Error("capture opt-in should register the archive listener");
	await listener.handler(material("acct:test:non-owner"));
	await listener.handler(material("plugin:wechat-archive", "not-allowlisted"));
	expect(await readdir(h.root).catch(() => [])).toEqual([]);
	await initialize(h.root);
	await listener.handler(material("plugin:wechat-archive"));
	expect(await readdir(h.root, { recursive: true })).toContain("timeline");
});
