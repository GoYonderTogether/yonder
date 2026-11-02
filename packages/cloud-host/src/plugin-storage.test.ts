import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { PluginAPI, PluginFiles, PluginStorage, ToolContext, Trigger } from "@yonder/sdk";
import { createFilePluginStorage, createRegistrationCollector, createTriggerScheduler } from "@yonder/sdk/testing";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { initialize } from "../../../plugins/memory/src/files.js";
import memory from "../../../plugins/memory/src/index.js";
import tasks from "../../../plugins/tasks/src/index.js";
import { createPostgresPluginStorage, migratePluginStorage } from "./plugin-storage.js";
import { testPostgres } from "./test-postgres.js";

let database: Awaited<ReturnType<typeof testPostgres>>;
let directory: string;
beforeAll(async () => {
	database = await testPostgres();
	await migratePluginStorage(database.pool);
	directory = await mkdtemp(join(tmpdir(), "yonder-plugin-files-"));
}, 60000);
afterAll(async () => {
	await database?.close();
	if (directory) await rm(directory, { recursive: true, force: true });
});

async function artifact(storage: PluginStorage) {
	const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
	const uri = await storage.writeAttachment("artifact.png", bytes, "image/png");
	const stored = uri.startsWith("file:")
		? await readFile(new URL(uri))
		: new Uint8Array(await (await fetch(uri)).arrayBuffer());
	expect([...stored]).toEqual([...bytes]);
}

async function contract(files: PluginFiles) {
	await files.write("counter.json", "0");
	await Promise.all(
		Array.from({ length: 12 }, () =>
			files.transaction(async (tx) => {
				const n = Number(await tx.read("counter.json"));
				await tx.write("counter.json", String(n + 1));
			}),
		),
	);
	expect(await files.read("counter.json")).toBe("12");
	await expect(
		files.transaction(async (tx) => {
			await tx.write("counter.json", "lost");
			await tx.write("second.txt", "lost");
			throw new Error("rollback");
		}),
	).rejects.toThrow("rollback");
	expect(await files.read("counter.json")).toBe("12");
	expect(await files.read("second.txt")).toBeUndefined();
	await files.mkdir("notes");
	await files.append("notes/原文.md", "一行\n");
	await files.append("notes/原文.md", "二行\n");
	expect(await files.read("notes/原文.md")).toBe("一行\n二行\n");
	expect(await files.list("notes")).toEqual([{ name: "原文.md", type: "file" }]);
	expect((await files.stat("notes/原文.md"))?.size).toBe(Buffer.byteLength("一行\n二行\n"));
	await expect(files.read("../outside")).rejects.toThrow("escapes");
	await files.remove("notes/原文.md");
	expect(await files.read("notes/原文.md")).toBeUndefined();
}

test("filesystem storage binds without side effects and retains existing files, formats and transactional updates", async () => {
	const root = join(directory, "files");
	const storage = createFilePluginStorage(root);
	const files = storage.open();
	await expect(access(root)).rejects.toMatchObject({ code: "ENOENT" });
	await mkdir(root);
	await writeFile(join(root, "watch.json"), '{"tasks":[]}\r\n');
	expect(await files.read("watch.json")).toBe('{"tasks":[]}\r\n');
	await artifact(storage);
	await contract(files);
	expect(await readFile(join(root, "watch.json"), "utf8")).toBe('{"tasks":[]}\r\n');
});

test("PG private storage shares the file contract and isolates plugin, tenant, Bot and configured root", async () => {
	const storage = createPostgresPluginStorage(database.pool, "owner-a", "bot-a", "memory");
	const files = storage.open("/library");
	expect(files.localRoot).toBeUndefined();
	await artifact(storage);
	await contract(files);
	for (const other of [
		createPostgresPluginStorage(database.pool, "owner-b", "bot-a", "memory"),
		createPostgresPluginStorage(database.pool, "owner-a", "bot-b", "memory"),
		createPostgresPluginStorage(database.pool, "owner-a", "bot-a", "tasks"),
	])
		expect(await other.open("/library").read("counter.json")).toBeUndefined();
	expect(await storage.open("/other-library").read("counter.json")).toBeUndefined();
	expect(
		await createPostgresPluginStorage(database.pool, "owner-a", "bot-a", "memory")
			.open("/library")
			.read("counter.json"),
	).toBe("12");
});

test("filesystem journal recovery rolls back an interrupted batch and preserves later user edits", async () => {
	const root = join(directory, "recovery");
	await mkdir(root);
	const files = createFilePluginStorage(root).open();
	const journal = join(root, ".yonder-storage-transaction.json");
	await writeFile(join(root, "projection.json"), "new");
	await writeFile(journal, JSON.stringify([{ path: "projection.json", content: "old", next: "new", mode: 0o600 }]));
	expect(await files.read("projection.json")).toBe("old");
	await expect(access(journal)).rejects.toMatchObject({ code: "ENOENT" });
	await writeFile(join(root, "projection.json"), "user edit after crash");
	await writeFile(journal, JSON.stringify([{ path: "projection.json", content: "old", next: "new", mode: 0o600 }]));
	await expect(files.read("projection.json")).rejects.toThrow("later user edits preserved");
	expect(await readFile(join(root, "projection.json"), "utf8")).toBe("user edit after crash");
	await rm(journal);
});

test("one real host timer serves multiple periodic triggers and stop releases pending ticks", async () => {
	const nativeSet = globalThis.setTimeout;
	const nativeClear = globalThis.clearTimeout;
	const handles = new Set<ReturnType<typeof setTimeout>>();
	let maximum = 0;
	const set = vi.spyOn(globalThis, "setTimeout").mockImplementation(((
		callback: (...args: unknown[]) => void,
		ms?: number,
		...args: unknown[]
	) => {
		const handle = nativeSet(() => {
			handles.delete(handle);
			callback(...args);
		}, ms);
		handles.add(handle);
		maximum = Math.max(maximum, handles.size);
		return handle;
	}) as typeof setTimeout);
	const clear = vi.spyOn(globalThis, "clearTimeout").mockImplementation((handle) => {
		if (handle) handles.delete(handle as ReturnType<typeof setTimeout>);
		nativeClear(handle);
	});
	const counts = [0, 0];
	const host = createTriggerScheduler((_key, error) => {
		throw error;
	});
	const stop: Array<() => Promise<void>> = [];
	try {
		for (const index of [0, 1]) {
			let schedule: (at: number | undefined) => void = () => {};
			const trigger: Trigger = {
				id: String(index),
				start: async (io) => {
					schedule = io.schedule;
					schedule(Date.now() + 10);
				},
				tick: async () => {
					counts[index] = counts[index]! + 1;
					schedule(Date.now() + 10);
				},
				stop: async () => {
					schedule(undefined);
				},
			};
			stop.push(
				await host.start(`bot-${index}:tick`, trigger, async (event) => ({
					...event,
					id: "event",
					ts: new Date().toISOString(),
				})),
			);
		}
		await delay(65);
		expect(counts.every((count) => count >= 2)).toBe(true);
		expect(maximum).toBe(1);
		await host.stop();
		await Promise.all(stop.map((dispose) => dispose()));
		const snapshot = [...counts];
		await delay(30);
		expect(counts).toEqual(snapshot);
		expect(handles.size).toBe(0);
	} finally {
		await host.stop();
		clear.mockRestore();
		set.mockRestore();
	}
});

test("disposing a trigger stops its active work before waiting for the tick to settle", async () => {
	const host = createTriggerScheduler((_key, error) => {
		throw error;
	});
	let entered!: () => void;
	let finish!: () => void;
	const started = new Promise<void>((resolve) => {
		entered = resolve;
	});
	const work = new Promise<void>((resolve) => {
		finish = resolve;
	});
	const dispose = await host.start(
		"active",
		{
			id: "active",
			start: async (io) => io.schedule(Date.now()),
			tick: async () => {
				entered();
				await work;
			},
			stop: async () => finish(),
		},
		async (event) => ({ ...event, id: "event", ts: new Date().toISOString() }),
	);
	try {
		await started;
		await dispose();
	} finally {
		finish();
		await host.stop();
	}
});

test("official memory reads and writes a PG virtual library without touching a cloud directory or local rg", async () => {
	const storage = createPostgresPluginStorage(database.pool, "owner-a", "memory-bot", "memory");
	const root = `/virtual-library-${Date.now()}`;
	const { api, registrations } = createRegistrationCollector();
	await memory.setup({
		...api,
		storage,
		config: { root, owner: "person:owner", timezone: "UTC", allowedAgents: ["main"] },
	} as PluginAPI);
	expect(
		(
			await database.pool.query("SELECT 1 FROM plugin_files WHERE tenant_id=$1 AND bot_id=$2", [
				"owner-a",
				"memory-bot",
			])
		).rows,
	).toEqual([]);
	await initialize(storage.open(root));
	const ctx = {
		agent: "main",
		profile: "default",
		session: "2",
		capabilities: ["read", "write", "admin"],
		signal: new AbortController().signal,
	} as ToolContext;
	const run = async (name: string, args: unknown) => {
		const result = await registrations.tools.find((tool) => tool.name === name)!.execute(args, ctx);
		if (result.isError) throw new Error(result.text);
		return JSON.parse(result.text);
	};
	const captured = await run("memory_capture", { text: "数据库记忆原文", when: "2026-11-02" });
	expect((await run("memory_search", { terms: ["数据库记忆"] })).files[0].path).toBe(captured.path);
	expect((await run("memory_read", { path: captured.path })).text).toContain("数据库记忆原文");
	await storage.open(root).write("private/hidden.md", "私密内容");
	await expect(run("memory_read", { path: "private/hidden.md" })).rejects.toThrow("includePrivate");
	expect((await run("memory_search", { terms: ["私密内容"] })).files).toEqual([]);
	await expect(access(root)).rejects.toMatchObject({ code: "ENOENT" });
});

test("official tasks_show uses the PG ledger and a text board without creating cloud file attachments", async () => {
	const storage = createPostgresPluginStorage(database.pool, "owner-a", "tasks-bot", "tasks");
	const { api, registrations } = createRegistrationCollector();
	const sent: Array<{ text: string; attachments?: unknown[] }> = [];
	const data = `/unavailable-cloud-task-files-${Date.now()}`;
	await tasks.setup({
		...api,
		storage,
		paths: { data },
		config: { audit: { enabled: false } },
		messages: {
			send: async (message) => {
				sent.push(message);
				return { ok: true };
			},
		},
	});
	const show = registrations.tools.find((tool) => tool.name === "tasks_show")!;
	const result = await show.execute({}, {
		agent: "main",
		profile: "default",
		session: "2",
		capabilities: ["read"],
		event: {
			id: "show",
			ts: new Date().toISOString(),
			type: "message.in",
			conv: "conv:card:room",
			data: { text: "Show the board" },
		},
		signal: new AbortController().signal,
	} as ToolContext);
	expect(result.isError).not.toBe(true);
	expect(sent).toHaveLength(1);
	expect(sent[0]!.text.length).toBeGreaterThan(0);
	expect(sent[0]!.attachments).toBeUndefined();
	expect((await storage.open().list()).some((file) => file.name.endsWith(".png"))).toBe(false);
	await expect(access(data)).rejects.toMatchObject({ code: "ENOENT" });
});
