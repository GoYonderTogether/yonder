import { mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginAPI, ToolContext } from "@yonder/sdk";
import { checkPlugin, createRegistrationCollector } from "@yonder/sdk/testing";
import { afterEach, expect, it } from "vitest";
import { capture } from "../src/capture.js";
import { initialize } from "../src/files.js";
import plugin from "../src/index.js";
import { Store } from "../src/store.js";

const dirs: string[] = [];
afterEach(async () => {
	await Promise.all(dirs.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});
async function temp() {
	const dir = await mkdtemp(join(tmpdir(), "memory-wp3-"));
	dirs.push(dir);
	return dir;
}
const ctx = {
	agent: "test",
	profile: "test",
	session: "wp3",
	capabilities: ["read", "write", "admin"],
	signal: new AbortController().signal,
	event: { type: "message.in", from: "acct:test:owner", conv: "conv:test:owner", data: {} },
} as ToolContext;
async function setup(extra = {}) {
	const root = await temp();
	await initialize(root);
	const config = {
		root,
		owner: "person:test",
		timezone: "UTC",
		allowedAgents: ["test"],
		allowedSourceConversations: ["conv:test:owner"],
		...extra,
	};
	const { api, registrations } = createRegistrationCollector();
	await plugin.setup({
		...api,
		config,
		identity: {
			...api.identity,
			async account() {
				return { person: "person:test" };
			},
		},
	} as PluginAPI);
	const run = async (name: string, args: unknown, context = ctx) => {
		const result = await registrations.tools.find((t) => t.name === name)!.execute(args, context);
		if (result.isError) throw new Error(result.text);
		return JSON.parse(result.text);
	};
	const note = (text: string, when: string, by: "owner" | "agent" = "agent", private_ = false) =>
		capture(config, new Store(root), { text, when, by, private: private_ }, ctx, async () => {
			throw new Error("note must not emit");
		});
	return { root, config, run, note };
}
async function put(root: string, path: string, text: string, date = "2026-01-01") {
	const file = join(root, path);
	await mkdir(file.slice(0, file.lastIndexOf("/")), { recursive: true });
	await writeFile(file, text);
	const ms = new Date(date).getTime() / 1000;
	await utimes(file, ms, ms);
}
it("matches packaged registrations with search/read declared", async () => {
	expect(await checkPlugin(new URL("..", import.meta.url).pathname)).toEqual([]);
});
it("searches Chinese substrings and input NFKC variants literally without modifying text", async () => {
	const r = await setup();
	await put(r.root, "mine/文字.md", "中文资料\n项目:测试\na.b literal\n⽂档原文\n");
	const a = await r.run("memory_search", { terms: ["文资", "项目："], match: "all" });
	expect(a.files.map((f: { path: string }) => f.path)).toEqual(["mine/文字.md"]);
	expect(a.files[0].hits.map((h: { line: number }) => h.line)).toEqual([1, 2]);
	expect(a.files[0].hits[0].origin).toBe("human-written");
	expect((await r.run("memory_search", { terms: ["a.b"] })).total).toBe(1);
	expect((await r.run("memory_search", { terms: ["文档原文"] })).total).toBe(0);
	expect(await readFile(join(r.root, "mine/文字.md"), "utf8")).toContain("⽂档原文");
});
it("filters origin/date by record including continuations, private mixtures and cross-year headings", async () => {
	const r = await setup();
	await r.note("共同关键词\n续行关键词", "2025-12-31", "owner");
	await r.note("共同关键词", "2026-01-01", "agent");
	await r.note("私密关键词\n续行关键词", "2026-01-02", "owner", true);
	await r.note("私密关键词", "2026-01-02", "agent", true);
	const a = await r.run("memory_search", {
		terms: ["关键词"],
		origin: ["human-said"],
		since: "2025-12-31",
		until: "2025-12-31",
	});
	expect(a.files).toHaveLength(1);
	expect(a.files[0].hits).toHaveLength(2);
	for (const h of a.files[0].hits) expect(h).toMatchObject({ origin: "human-said", date: "2025-12-31" });
	expect(
		(
			await r.run("memory_search", {
				terms: ["共同关键词"],
				origin: ["agent"],
				since: "2026-01-01",
				until: "2026-01-01",
			})
		).files[0].hits[0],
	).toMatchObject({ origin: "agent", date: "2026-01-01" });
	expect((await r.run("memory_search", { terms: ["私密关键词"] })).files).toEqual([]);
	const secret = await r.run("memory_search", {
		terms: ["关键词"],
		zones: ["private"],
		includePrivate: true,
		origin: ["human-said"],
	});
	expect(secret.files[0].hits).toHaveLength(2);
	expect(secret.files[0].hits.every((h: { origin: string }) => h.origin === "human-said")).toBe(true);
});
it("sorts by distinct terms, counts then newest date; handles any/all, zones and limits", async () => {
	const r = await setup();
	await put(r.root, "mine/both.md", "alpha beta\n", "2026-01-01");
	await put(r.root, "me/count.md", "---\norigin: external\n---\nalpha alpha\n", "2026-01-03");
	await put(r.root, "raw/new.md", "---\norigin: external\n---\nalpha\n", "2026-01-04");
	await put(r.root, "life/old.md", "alpha\n", "2026-01-02");
	await put(r.root, "archive/hidden.md", "alpha beta\n");
	await put(r.root, "me/private.md", "---\nprivate: true\n---\nalpha beta\n");
	const a = await r.run("memory_search", { terms: ["alpha", "beta"], limit: 3 });
	expect(a.files.map((f: { path: string }) => f.path)).toEqual(["mine/both.md", "me/count.md", "raw/new.md"]);
	expect(a).toMatchObject({ total: 4, truncated: true });
	expect(a.files[1].hits[0].origin).toBe("derived");
	expect((await r.run("memory_search", { terms: ["alpha", "beta"], match: "all" })).total).toBe(1);
	expect((await r.run("memory_search", { terms: ["alpha"], zones: ["archive"] })).files[0].path).toBe(
		"archive/hidden.md",
	);
	expect(
		(
			await r.run("memory_search", {
				terms: ["alpha"],
				zones: ["raw"],
				origin: ["external"],
				since: "2026-01-04",
				until: "2026-01-04",
			})
		).files[0].hits[0].origin,
	).toBe("external");
});
it("keeps registered sources byte/mtime identical and uses configured origin and namespaced paths", async () => {
	const source = await temp();
	await put(source, "笔记/内容.md", "外部中文资料\n后一行\n");
	const file = join(source, "笔记/内容.md"),
		before = { bytes: await readFile(file), mtime: (await stat(file, { bigint: true })).mtimeNs };
	const r = await setup({ roots: [{ name: "notes", path: source, origin: "human" }] });
	const found = await r.run("memory_search", { terms: ["中文"], zones: ["notes"] });
	expect(found.files[0]).toMatchObject({
		path: "notes:笔记/内容.md",
		hits: [{ line: 1, origin: "human-written", text: "外部中文资料\n后一行" }],
	});
	expect(await r.run("memory_read", { path: "notes:笔记/内容.md", lines: 1 })).toMatchObject({
		path: "notes:笔记/内容.md",
		origin: "human-written",
		fromLine: 1,
		toLine: 1,
		totalLines: 2,
		text: "外部中文资料",
		truncated: true,
	});
	expect(await readFile(file)).toEqual(before.bytes);
	expect((await stat(file, { bigint: true })).mtimeNs).toBe(before.mtime);
});
it("rejects escapes and symbolic links; search never follows links or hidden/nontext files", async () => {
	const outside = await temp();
	await put(outside, "secret.md", "边界秘密\n");
	const r = await setup();
	await symlink(outside, join(r.root, "mine/link"));
	await symlink(join(outside, "secret.md"), join(r.root, "mine/link.md"));
	for (const path of ["../secret.md", "mine/link/secret.md", "mine/link.md", "/etc/passwd"])
		await expect(r.run("memory_read", { path })).rejects.toThrow();
	await put(r.root, "mine/.hidden.md", "边界秘密");
	await put(r.root, "mine/.obsidian/a.md", "边界秘密");
	await put(r.root, "mine/node_modules/a.md", "边界秘密");
	await put(r.root, "mine/binary.pdf", "边界秘密");
	expect((await r.run("memory_search", { terms: ["边界秘密"] })).files).toEqual([]);
});
it("paginates reads, truncates at 12000 chars and requires explicit private access", async () => {
	const r = await setup();
	const note = await r.note("私密记录", "2026-01-02", "owner", true);
	await expect(r.run("memory_read", { path: note.path })).rejects.toThrow("includePrivate");
	expect((await r.run("memory_read", { path: note.path, includePrivate: true })).text).toContain("私密记录");
	await r.note("公开记录", "2026-01-02");
	expect((await r.run("memory_read", { week: "2026-W01" })).path).toBe("timeline/2026-01/2026-W01.md");
	await put(r.root, "mine/long.md", "x".repeat(12500) + "\nsecond\nthird\n");
	expect(await r.run("memory_read", { path: "mine/long.md", fromLine: 2, lines: 1 })).toMatchObject({
		text: "second",
		fromLine: 2,
		toLine: 2,
		totalLines: 3,
		truncated: true,
	});
	const long = await r.run("memory_read", { path: "mine/long.md" });
	expect(long.text).toHaveLength(12000);
	expect(long.truncated).toBe(true);
});
it("validates boundaries, dates, capability/cancellation and unambiguous path/week inputs", async () => {
	const r = await setup();
	for (const args of [
		{ terms: [] },
		{ terms: Array(9).fill("x") },
		{ terms: ["x"], limit: 101 },
		{ terms: ["x"], since: "2026-02-30" },
		{ terms: ["x"], since: "2026-02-02", until: "2026-01-01" },
		{ terms: ["x"], zones: ["unknown"] },
		{ terms: ["x"], origin: ["invented"] },
	])
		await expect(r.run("memory_search", args)).rejects.toThrow();
	for (const args of [
		{},
		{ path: "SCHEMA.md", week: "2026-W01" },
		{ week: "2026-W99" },
		{ path: "SCHEMA.md", lines: 401 },
		{ path: "SCHEMA.md", fromLine: 0 },
	])
		await expect(r.run("memory_read", args)).rejects.toThrow();
	await expect(r.run("memory_search", { terms: ["x"] }, { ...ctx, capabilities: ["read"] })).rejects.toThrow("admin");
	const controller = new AbortController();
	controller.abort();
	await expect(r.run("memory_search", { terms: ["x"] }, { ...ctx, signal: controller.signal })).rejects.toThrow();
	expect(await readdir(r.root)).not.toContain(".yonder-contract-data");
});

it("reports a real missing rg without a fallback implementation", async () => {
	const r = await setup();
	const empty = await temp(),
		saved = process.env.PATH;
	try {
		process.env.PATH = empty;
		await expect(r.run("memory_search", { terms: ["x"] })).rejects.toThrow("ripgrep (rg) unavailable in PATH");
		expect((await r.run("memory_status", {})).rg.available).toBe(false);
	} finally {
		if (saved === undefined) delete process.env.PATH;
		else process.env.PATH = saved;
	}
});
