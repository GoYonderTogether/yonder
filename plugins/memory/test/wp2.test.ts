import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EventInput, PluginAPI, ToolContext, YEvent } from "@yonder/sdk";
import { createRegistrationCollector } from "@yonder/sdk/testing";
import { DateTime } from "luxon";
import { afterEach, expect, it } from "vitest";
import { heading, moment, weekInfo } from "../src/calendar.js";
import { initialize, metadata } from "../src/files.js";
import plugin from "../src/index.js";
import { organizeText, records, writeSection } from "../src/records.js";
import { Store, type WriteContext } from "../src/store.js";

const dirs: string[] = [];
afterEach(async () => {
	await Promise.all(dirs.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});
async function temp() {
	const root = await mkdtemp(join(tmpdir(), "memory-wp2-"));
	dirs.push(root);
	await initialize(root);
	return root;
}
const ctx: ToolContext = {
	agent: "test",
	profile: "test",
	session: "wp2",
	capabilities: ["read", "write", "admin"],
	signal: new AbortController().signal,
} as ToolContext;
const meta: WriteContext = { op: "test.section", id: "-", by: "plugin:memory", session: "wp2", signal: ctx.signal };
async function setup(root: string, extra = {}) {
	const { api, registrations } = createRegistrationCollector(),
		events: EventInput[] = [];
	await plugin.setup({
		...api,
		config: { root, owner: "person:test", timezone: "UTC", ...extra },
		events: {
			...api.events,
			async emit(event: EventInput) {
				events.push(event);
				return { ...event, id: randomUUID(), ts: new Date().toISOString() } as YEvent;
			},
		},
	} as PluginAPI);
	const tool = registrations.tools.find((t) => t.name === "memory_capture")!;
	return {
		events,
		async capture(args: unknown, context = ctx) {
			const result = await tool.execute(args, context);
			if (result.isError) throw new Error(result.text);
			return JSON.parse(result.text) as { id: string; path: string; paths: string[] };
		},
		tool,
	};
}
it("uses local time, ISO week year and Thursday month including DST and year boundaries", () => {
	for (const [iso, zone, path] of [
		["2021-01-01T01:00:00Z", "UTC", "timeline/2020-12/2020-W53.md"],
		["2024-12-30T12:00:00Z", "UTC", "timeline/2025-01/2025-W01.md"],
		["2026-03-01T00:30:00Z", "America/Los_Angeles", "timeline/2026-02/2026-W09.md"],
		["2026-03-08T07:30:00Z", "America/New_York", "timeline/2026-03/2026-W10.md"],
	])
		expect(weekInfo(moment(zone, iso)).path).toBe(path);
	expect(heading(DateTime.fromISO("2026-01-04"))).toBe("### 01-04 周日");
});
it("serializes concurrent appends without losing records and logs metadata only", async () => {
	const root = await temp(),
		r = await setup(root);
	const results = await Promise.all(
		Array.from({ length: 40 }, (_, i) => r.capture({ text: `并发记录 ${i}`, when: "2026-01-01T12:00:00Z" })),
	);
	const text = await readFile(join(root, results[0]!.path), "utf8");
	expect(records(text)).toHaveLength(40);
	expect(new Set(results.map((r) => r.id)).size).toBe(40);
	expect(text.match(/^### /gm)).toHaveLength(1);
	for (let i = 0; i < 40; i++) expect(text).toContain(`并发记录 ${i} (ref: agent:test)`);
	const log = await readFile(join(root, "log.md"), "utf8");
	expect(log).not.toContain("并发记录");
	expect(log.match(/memory_capture timeline\/2026-01\/2026-W01.md/g)).toHaveLength(41);
	expect(log).toContain("by agent:test session:wp2");
});
it("preserves multiline/blank body bytes, organizes idempotently and leaves record stream last", async () => {
	const root = await temp(),
		r = await setup(root),
		body = "首行\n\n  原有缩进\r\n尾行\n";
	const result = await r.capture({ text: body, by: "owner", when: "2026-01-01" });
	const before = await readFile(join(root, result.path), "utf8"),
		store = new Store(root);
	expect(before).toContain(body.replace(/\n/g, "\n  "));
	await store.edit(result.path, (text) => organizeText(text!, result.id, "me/now"), meta);
	const after = await readFile(join(root, result.path), "utf8");
	expect(after).toBe(before.replace("- [ ]", "- [x]").replace(`^${result.id}`, `^${result.id} → me/now`));
	const mtime = (await stat(join(root, result.path))).mtimeMs;
	await store.edit(result.path, (text) => organizeText(text!, result.id, "me/now"), meta);
	expect((await stat(join(root, result.path))).mtimeMs).toBe(mtime);
	await store.edit(result.path, (text) => writeSection(text!, "复盘", "回顾 (ref: 记录)", "replace"), meta);
	await store.edit(result.path, (text) => writeSection(text!, "复盘", "追加 (ref: 记录)", "append"), meta);
	const edited = await readFile(join(root, result.path), "utf8");
	expect(edited.slice(edited.indexOf("## 记录流"))).toBe(after.slice(after.indexOf("## 记录流")));
	expect(edited).toContain("回顾 (ref: 记录)\n追加 (ref: 记录)\n## 记录流");
});
it("re-reads a real intervening user edit once and refuses a second conflict without overwriting it", async () => {
	const root = await temp(),
		path = "timeline/edit.md",
		file = join(root, path),
		store = new Store(root);
	await writeFile(file, "原文\n");
	let calls = 0;
	await store.edit(
		path,
		async (text) => {
			if (calls++ === 0) {
				await writeFile(file, "用户编辑\n");
				await utimes(file, 1, 1);
			}
			return `${text}插件追加\n`;
		},
		meta,
	);
	expect(calls).toBe(2);
	expect(await readFile(file, "utf8")).toBe("用户编辑\n插件追加\n");
	calls = 0;
	await expect(
		store.edit(
			path,
			async (text) => {
				calls++;
				await writeFile(file, `用户冲突 ${calls}\n`);
				await utimes(file, calls + 5, calls + 5);
				return `${text}不应写入`;
			},
			meta,
		),
	).rejects.toThrow("after one retry");
	expect(calls).toBe(2);
	expect(await readFile(file, "utf8")).toBe("用户冲突 2\n");
	expect(await readdir(dirnameOf(file))).toEqual(["edit.md"]);
});
function dirnameOf(file: string) {
	return file.slice(0, file.lastIndexOf("/"));
}
it("backs up long notes and material verbatim with origin/title and emits only material", async () => {
	const root = await temp(),
		r = await setup(root, { capture: { inlineMax: 10 } }),
		body = "长正文\n\n".repeat(80);
	const long = await r.capture({ text: body, by: "owner", when: "2026-01-01" });
	const raw = await readFile(join(root, long.paths[0]!), "utf8");
	expect(metadata(raw).origin).toBe("human-said");
	expect(raw.slice(raw.indexOf("\n---\n") + 5)).toBe(body);
	expect(await readFile(join(root, long.path), "utf8")).toContain(`→ ${long.paths[0]}`);
	expect(r.events).toHaveLength(0);
	const material = await r.capture({
		text: "资料原文",
		kind: "material",
		by: "owner",
		title: "标题: \n第二行",
		when: "2026-01-01",
	});
	expect(metadata(await readFile(join(root, material.paths[0]!), "utf8"))).toMatchObject({
		origin: "agent",
		title: "标题: \n第二行",
	});
	expect(r.events).toMatchObject([
		{
			type: "memory.captured",
			conv: "conv:memory-inbox:default",
			data: { path: material.paths[0], origin: "agent", source: "material" },
		},
	]);
});
it("keeps private mixed-source entries out of the timeline and rejects invalid captures before writing", async () => {
	const root = await temp(),
		r = await setup(root);
	await r.capture({ text: "私密原话", private: true, by: "owner", when: "2026-01-02" });
	await r.capture({ text: "私密推断", private: true, when: "2026-01-02" });
	const text = await readFile(join(root, "private/2026-01.md"), "utf8");
	expect(metadata(text).private).toBe(true);
	expect(records(text).map((e) => e.source)).toEqual(["said", "capture"]);
	expect(await readdir(join(root, "timeline"))).toEqual([]);
	for (const input of [
		{ text: "x", private: true, kind: "material" },
		{ text: "x", when: "2999-01-01" },
		{ text: "x", when: "2026-02-30" },
		{ text: "x", unknown: true },
	])
		await expect(r.capture(input)).rejects.toThrow();
	expect((await r.tool.execute({ text: "x" }, { ...ctx, capabilities: ["read", "admin"] })).isError).toBe(true);
	const abort = new AbortController();
	abort.abort();
	expect((await r.tool.execute({ text: "x" }, { ...ctx, signal: abort.signal })).isError).toBe(true);
});
it("appends backdated day headings in arrival order without reordering prior records", async () => {
	const root = await temp(),
		r = await setup(root);
	const a = await r.capture({ text: "第一条", when: "2026-01-02" });
	await r.capture({ text: "补记", when: "2026-01-01" });
	await r.capture({ text: "再次到达", when: "2026-01-02" });
	const text = await readFile(join(root, a.path), "utf8");
	expect([...text.matchAll(/^### .*$/gm)].map((m) => m[0])).toEqual([
		"### 01-02 周五",
		"### 01-01 周四",
		"### 01-02 周五",
	]);
});
