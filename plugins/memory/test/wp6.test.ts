import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { Bootstrap } from "../src/bootstrap.js";
import { Wechat } from "../src/wechat.js";
import { context, event, harness } from "./harness.js";

const active: Array<Awaited<ReturnType<typeof harness>>> = [];
afterEach(async () => {
	for (const h of active.splice(0)) await h.dispose();
});
async function setup(extra = {}) {
	const h = await harness(extra);
	active.push(h);
	return h;
}
it("emits first-run once, persists ack and suppresses it after restart; audit is byte/mtime read-only", async () => {
	const h = await setup(),
		b = new Bootstrap(h.api, h.config, new Wechat(h.api, h.config), []);
	await b.trigger().start({ emit: (e) => h.api.events.emit(e) });
	try {
		expect(h.events.filter((e) => (e.data as { reason: string }).reason === "first-run")).toHaveLength(1);
		await b.check((e) => h.api.events.emit(e));
		expect(h.events).toHaveLength(1);
		await h.run("bootstrap", { op: "ack", reason: "first-run", snoozeDays: 2 });
		await b.check((e) => h.api.events.emit(e));
		expect(h.events).toHaveLength(1);
		expect((await h.run("bootstrap", { op: "state" })).initialized).toBeTruthy();
		const snapshot = async () => {
			const files = await readdir(h.root, { recursive: true, withFileTypes: true });
			return Promise.all(
				files
					.filter((f) => f.isFile())
					.map(async (f) => {
						const path = join(f.parentPath, f.name);
						return [
							path,
							(await readFile(path)).toString("base64"),
							(await stat(path, { bigint: true })).mtimeNs.toString(),
						];
					}),
			);
		};
		const before = await snapshot();
		const audit = await h.run("bootstrap", { op: "audit" });
		expect(audit.total.files).toBeGreaterThan(0);
		expect(audit.total.tokens).toBeGreaterThan(0);
		expect(await snapshot()).toEqual(before);
		for (const zone of audit.zones) expect(zone.files).toBeGreaterThanOrEqual(0);
	} finally {
		await b.trigger().stop();
	}
});
it("reports backlog and unsupported formats without converting files", async () => {
	const h = await setup({ bootstrap: { unorganized: 1, staleDays: 1 } });
	await h.run("capture", { text: "待整理记录", when: "2026-01-01" });
	await writeFile(join(h.root, "inbox/unconverted.pdf"), "原件");
	const b = new Bootstrap(h.api, h.config, new Wechat(h.api, h.config), []);
	await b.check((e) => h.api.events.emit(e));
	expect(h.events.some((e) => (e.data as { reason: string }).reason === "backlog")).toBe(true);
	const audit = await h.run("bootstrap", { op: "audit" });
	expect(audit.unestimated).toContainEqual({ path: "inbox/unconverted.pdf", reason: "not converted" });
	expect(await readFile(join(h.root, "inbox/unconverted.pdf"), "utf8")).toBe("原件");
});
it("uses shared realtime/history keys, self origin/evidence and skips unlisted or undated material", async () => {
	const h = await setup({ sources: { wechat: { chats: [{ chat: "test-chat", self: true }] } } }),
		wx = new Wechat(h.api, h.config);
	const message = {
		id: 1,
		chat: "test-chat",
		timestamp: 1700000000,
		text: "确定性来源",
		url: "https://example.invalid/resource",
		media: { kind: "image", name: "metadata-only" },
	};
	await wx.material(
		event("wechat-archive.material", "plugin:wechat-archive", {
			chat: "outside",
			messages: [{ ...message, chat: "outside" }],
		}),
	);
	await wx.material(
		event("wechat-archive.material", "plugin:wechat-archive", {
			chat: "test-chat",
			messages: [message, { ...message, id: 2, timestamp: null }],
		}),
	);
	await wx.material(
		event("wechat-archive.material", "plugin:wechat-archive", { chat: "test-chat", messages: [message] }),
	);
	const pending = await h.run("review", { op: "pending" });
	expect(pending.entries).toHaveLength(1);
	expect(pending.entries[0].source).toBe("wechat-self");
	await h.run("me", {
		op: "add",
		file: "profile",
		text: "证据引用",
		status: "confirmed",
		evidence: `^${pending.entries[0].id}`,
	});
	await expect(h.run("import", { source: "wechat", chat: "outside" })).rejects.toThrow("allowlisted");
});
const chat = process.env.MEMORY_TEST_WECHAT_CHAT;
it.skipIf(!chat)(
	"imports the explicitly authorized real chat into a disposable root and deduplicates the second import",
	{ timeout: 180000 },
	async () => {
		const h = await setup({ sources: { wechat: { chats: [{ chat: chat!, self: true }] } } });
		const first = await h.run("import", { source: "wechat", chat: chat! });
		const second = await h.run("import", { source: "wechat", chat: chat! });
		expect(first.read).toBeGreaterThan(0);
		expect(first.written).toBeGreaterThan(0);
		expect(second.written).toBe(0);
		expect(second.read).toBe(first.read);
		const pending = await h.run("review", { op: "pending", limit: 200 });
		expect(pending.entries.every((e: { source: string }) => e.source === "wechat-self")).toBe(true);
		const audit = await h.run("bootstrap", { op: "audit" });
		console.log(
			JSON.stringify({
				realWechat: {
					read: first.read,
					written: first.written,
					skipped: first.skipped,
					secondWritten: second.written,
					secondSkipped: second.skipped,
					chars: audit.wechat[0].chars,
					deduplicated: true,
				},
			}),
		);
	},
);
