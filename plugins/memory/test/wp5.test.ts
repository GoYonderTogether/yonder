import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { context, event, harness } from "./harness.js";

const active: Array<Awaited<ReturnType<typeof harness>>> = [];
afterEach(async () => {
	for (const h of active.splice(0)) await h.dispose();
});
async function setup() {
	const h = await harness();
	active.push(h);
	return h;
}
function later() {
	const e = event();
	e.ts = new Date(Date.now() + 1000).toISOString();
	return context(e);
}
it("proposes separately from plans, enforces owner/later-run commit and updates Tasks states", async () => {
	const h = await setup();
	const same = context(event());
	const proposal = await h.run(
		"plan",
		{ op: "propose", scope: "week", period: "2026-W43", items: [{ text: "执行可验收事项", due: "2026-10-22" }] },
		same,
	);
	for (const ctx of [context(event("cron.test", "plugin:cron")), same, context(event("message.in", "acct:test:other"))])
		await expect(
			h.run("plan", { op: "commit", scope: "week", period: "2026-W43", ids: proposal.ids }, ctx),
		).rejects.toThrow();
	await h.run("plan", { op: "commit", scope: "week", period: "2026-W43", ids: proposal.ids }, later());
	const get = await h.run("plan", { op: "get", scope: "week", period: "2026-W43" });
	expect(get.text).toContain("📅 2026-10-22");
	expect(get.text).toContain("(ref: evt:");
	for (const status of ["postponed", "postponed", "done", "dropped", "open"])
		await h.run("plan", { op: "update", scope: "week", period: "2026-W43", id: proposal.ids[0], status });
	expect((await h.run("plan", { op: "get", scope: "week", period: "2026-W43" })).text).toContain("⟳2");
});
it("supports month/year/vision templates and refuses invalid dates/sections", async () => {
	const h = await setup();
	for (const scope of ["month", "year"]) {
		const p = await h.run("plan", { op: "propose", scope, items: [{ text: "周期提议" }] });
		await h.run("plan", { op: "commit", scope, ids: p.ids }, later());
		expect((await h.run("plan", { op: "get", scope })).text).toContain("周期提议");
	}
	expect((await h.run("plan", { op: "get", scope: "vision" })).text).toContain("## 愿景");
	await expect(
		h.run("plan", { op: "propose", scope: "week", items: [{ text: "x", due: "2026-02-30" }] }),
	).rejects.toThrow("due");
	await expect(
		h.run("review", { op: "section", scope: "week", name: "记录流", mode: "replace", text: "破坏" }),
	).rejects.toThrow();
});
it("organizes verbatim records idempotently and close requires review but only warns for backlog", async () => {
	const h = await setup(),
		first = await h.run("capture", { text: "一字不改\n\n续行", when: "2026-10-20" });
	await h.run("capture", { text: "留待整理", when: "2026-10-20" });
	const pending = await h.run("review", { op: "pending", week: "2026-W43" });
	expect(pending.entries).toHaveLength(2);
	await expect(h.run("review", { op: "close", week: "2026-W43" })).rejects.toThrow("empty review");
	const file = join(h.root, first.path),
		before = await readFile(file, "utf8");
	await h.run("review", { op: "organize", entries: [{ id: first.id, to: "project:测试" }] });
	const after = await readFile(file, "utf8");
	expect(after).toBe(before.replace("- [ ]", "- [x]").replace(`^${first.id}`, `^${first.id} → project:测试`));
	const time = (await stat(file)).mtimeMs;
	await h.run("review", { op: "organize", entries: [{ id: first.id, to: "project:测试" }] });
	expect((await stat(file)).mtimeMs).toBe(time);
	await h.run("review", {
		op: "section",
		scope: "week",
		period: "2026-W43",
		name: "复盘",
		mode: "replace",
		text: "复盘 (ref: 记录)",
	});
	expect((await h.run("review", { op: "close", week: "2026-W43" })).warnings).toHaveLength(1);
});
it("only owner events or deterministic chat records can establish confirmed facts", async () => {
	const h = await setup();
	for (const evidence of [undefined, "evt:invented", "^invented"])
		await expect(
			h.run("me", {
				op: "add",
				file: "profile",
				text: "待核对事实",
				status: "confirmed",
				...(evidence ? { evidence } : {}),
			}),
		).rejects.toThrow("evidence");
	const said = await h.run("capture", { text: "模型转述", by: "owner" });
	await expect(
		h.run("me", { op: "add", file: "profile", text: "事实", status: "confirmed", evidence: `^${said.id}` }),
	).rejects.toThrow();
	const e = event();
	await h.run(
		"me",
		{ op: "add", file: "profile", text: "事件证据", status: "confirmed", evidence: `evt:${e.id}` },
		context(e),
	);
	const listener = h.registrations.listeners.find((l) => l.type === "message.in")!;
	// This harness has no capture whitelist: no deterministic record, so it cannot become evidence.
	await listener.handler(e);
	expect((await h.run("me", { op: "read", file: "profile" })).files[0].text).toContain("事件证据 {confirmed}");
});
it("confirms only a later owner run; supersede retains history and hand-edits render as confirmed", async () => {
	const h = await setup();
	const add = await h.run("me", { op: "add", file: "now", text: "旧推断", status: "inferred" });
	await expect(
		h.run("me", { op: "confirm", id: add.ids[0] }, context(event("cron.test", "plugin:cron"))),
	).rejects.toThrow("owner");
	await h.run("me", { op: "confirm", id: add.ids[0] }, later());
	const newer = await h.run("me", { op: "supersede", id: add.ids[0], text: "新推断", status: "inferred" });
	const file = join(h.root, newer.path),
		text = await readFile(file, "utf8");
	expect(text.indexOf("新推断")).toBeLessThan(text.indexOf("## 历史"));
	expect(text).toContain("[至 ");
	await writeFile(file, text.replace("新推断", "用户改写"));
	expect((await h.run("me", { op: "read", file: "now" })).files[0].text).toContain("用户改写 {confirmed}");
	expect(await readFile(file, "utf8")).toContain("用户改写 {inferred}");
});
