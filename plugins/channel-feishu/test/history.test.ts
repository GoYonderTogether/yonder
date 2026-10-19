import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EventInput, PluginAPI, YEvent } from "@yonder/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FeishuChannel } from "../src/channel.js";
import { FeishuConnection } from "../src/connection.js";
import { historyPage, mergedInput, type Prepared, recoveryBatches } from "../src/history.js";

const roots: string[] = [];
afterEach(async () => {
	vi.restoreAllMocks();
	for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
const item = (id: string, time: number, sender = "user-a", extra = {}) => ({
	message_id: id,
	chat_id: "chat",
	msg_type: "text",
	create_time: String(time),
	sender: { id: sender, id_type: "open_id", sender_type: "user", tenant_key: "tenant" },
	body: { content: JSON.stringify({ text: id }) },
	...extra,
});
async function harness(ledger: YEvent[] = [], options: { preserveWatermarks?: boolean; history?: object } = {}) {
	const root = await mkdtemp(join(tmpdir(), "yonder-feishu-history-"));
	roots.push(root);
	const api = {
		paths: { data: root },
		events: { query: vi.fn(async () => ({ events: ledger })) },
		log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
	} as unknown as PluginAPI;
	const channel = new FeishuChannel("test", { appId: "test-app", secret: "unused" }, api);
	vi.spyOn(FeishuConnection.prototype, "start").mockResolvedValue();
	const emitted: EventInput[] = [];
	const emit = vi.fn(async (input: EventInput) => {
		emitted.push(input);
		const event = { ...input, id: `event-${emitted.length}`, ts: new Date().toISOString() };
		ledger.push(event);
		return event;
	});
	if (options.history) {
		await mkdir(join(root, "test"), { recursive: true });
		await writeFile(join(root, "test", "history.json"), JSON.stringify(options.history));
	}
	await channel.start({ emit, ask: vi.fn() });
	const internal = channel as unknown as {
		catchup(): Promise<void>;
		ready(): Promise<void>;
		receive(raw: unknown): Promise<void>;
		baseline: number;
		conversations: Map<string, { kind: "dm" | "group"; through: number }>;
	};
	if (!options.preserveWatermarks) {
		internal.baseline = 1000;
		internal.conversations.set("chat", { kind: "group", through: 1000 });
	}
	return { channel, internal, emitted, emit, root, ledger };
}

describe("Feishu history protocol (no network/model)", () => {
	it("migrates old ledgers from the latest completed native timestamp and recovers the upgrade gap", async () => {
		const event = (id: string, data: object, ts = 9000): YEvent => ({
			id,
			ts: new Date(ts).toISOString(),
			type: "message.in",
			conv: "conv:test:chat",
			from: "acct:test:user-a",
			data: { kind: "dm", tenant: "tenant", ...data },
		});
		const ledger = [
			event("old", { msgId: "old" }, 1000),
			event("batch", {
				originals: [
					{ messageId: "accepted", createdAt: "2000" },
					{ messageId: "partial", createdAt: "8000", complete: false },
				],
			}),
			event("earlier", { msgId: "earlier", createdAt: "1500" }),
			event("partial-only", { originals: [{ messageId: "unfinished", createdAt: "10000", complete: false }] }, 11000),
			{ ...event("legacy-no-time", { msgId: "legacy-no-time" }, 4000), conv: "conv:test:legacy" },
		];
		const { channel, internal, emitted, root } = await harness(ledger, { preserveWatermarks: true });
		expect(internal.conversations.get("chat")?.through).toBe(2000);
		expect(internal.conversations.get("legacy")?.through).toBe(4000);
		internal.conversations.delete("legacy");
		expect(internal.baseline).toBeGreaterThan(8000);
		vi.spyOn(channel.client, "request").mockImplementation(async (path) => {
			if (path.startsWith("/im/v1/chats?")) return { data: { items: [] } };
			return { data: { items: [item("accepted", 2000), item("upgrade-gap", 3000)] } };
		});
		await internal.catchup();
		expect(emitted).toHaveLength(1);
		expect(emitted[0].data).toMatchObject({ originals: [{ messageId: "upgrade-gap" }] });
		const saved = JSON.parse(await readFile(join(root, "test", "history.json"), "utf8"));
		expect(saved.conversations[0].through).toBeGreaterThan(3000);
		await channel.stop();
	});
	it("preserves saved watermarks and gives an empty installation a present-time baseline", async () => {
		const ledger: YEvent[] = [
			{
				id: "old",
				ts: new Date(1000).toISOString(),
				type: "message.in",
				conv: "conv:test:chat",
				data: { kind: "dm", msgId: "old" },
			},
		];
		const existing = await harness(ledger, {
			preserveWatermarks: true,
			history: { baseline: 500, conversations: [{ chat: "chat", kind: "dm", through: 7000 }] },
		});
		expect(existing.internal.conversations.get("chat")?.through).toBe(7000);
		expect(existing.internal.baseline).toBe(500);
		await existing.channel.stop();
		const before = Date.now();
		const fresh = await harness([], { preserveWatermarks: true });
		expect(fresh.internal.baseline).toBeGreaterThanOrEqual(before);
		expect(fresh.internal.conversations.size).toBe(0);
		await fresh.channel.stop();
	});
	it("keeps fixed millisecond boundaries and page tokens, locally filters threads", async () => {
		const request = vi.fn(async () => ({
			data: { items: [item("old", 999), item("yes", 1000), item("late", 2001)], has_more: true, page_token: "next" },
		}));
		const page = await historyPage(
			{ request } as never,
			{ chat: "chat", thread: "thread", start: 1000, end: 2000, pageToken: "prior" },
			new AbortController().signal,
		);
		expect(page.items.map((row) => row.message_id)).toEqual(["yes"]);
		expect(page.next).toBe("next");
		const params = new URL(request.mock.calls[0]?.[0] as string, "https://feishu.invalid").searchParams;
		expect(params.get("container_id_type")).toBe("thread");
		expect(params.get("page_token")).toBe("prior");
		expect(params.has("start_time")).toBe(false);
	});
	it("isolates sender/conversation batches and splits large Unicode without loss", () => {
		const message = (text: string, from: string, conv = "conv:test:chat"): Prepared => ({
			key: from + text.length,
			input: { type: "message.in", from, conv, data: { text } },
			original: { messageId: from, text, createdAt: "1792378639000", replyTo: "parent-id", threadId: "thread-id" },
		});
		const text = "汉🙂".repeat(15000);
		const batches = recoveryBatches([
			message("first", "a"),
			message("third", "a"),
			message("second", "b"),
			message(text, "a"),
			message("other", "a", "conv:test:other"),
		]);
		for (const batch of batches) {
			const input = mergedInput(batch, "id");
			expect(Buffer.byteLength((input.data as { text: string }).text)).toBeLessThanOrEqual(65536);
			expect(new Set(batch.map((row) => row.input.from)).size).toBe(1);
			expect(new Set(batch.map((row) => row.input.conv)).size).toBe(1);
		}
		const pieces = batches.flat().filter((row) => row.original.text === text);
		expect(pieces.map((row) => (row.input.data as { text: string }).text).join("")).toBe(text);
		expect(pieces.slice(0, -1).every((row) => row.original.complete === false)).toBe(true);
		expect(pieces.at(-1)?.original.complete).toBe(true);
		for (const batch of recoveryBatches([message(text, "a"), message("first", "b"), message("second", "b")], 512)) {
			const input = mergedInput(batch, "small");
			const body = (input.data as { text: string }).text;
			expect(Buffer.byteLength(body)).toBeLessThanOrEqual(512);
			expect(body).toContain("恢复历史消息，非新发送");
			expect(body).toContain(new Date(1792378639000).toISOString());
			expect(body).toContain("消息ID:");
			expect(body).toContain("引用: parent-id");
			expect(body).toContain("线程: thread-id");
			expect((input.data as { originals: object[] }).originals).toEqual(batch.map((row) => row.original));
		}
		expect(() => recoveryBatches([message("汉", "a")], 8)).toThrow("metadata exceeds");
		const one = message("汉", "a");
		const headerBytes = Buffer.byteLength(
			(mergedInput([{ ...one, input: { ...one.input, data: { text: "" } } }], "empty").data as { text: string }).text,
		);
		expect(() => recoveryBatches([one], headerBytes + 2)).toThrow("insufficient text budget");
	});
	it("preserves A1 B2 A3 order and splits continuous same-sender messages at thread boundaries", () => {
		const message = (id: string, from: string, threadId = ""): Prepared => ({
			key: id,
			input: { type: "message.in", from, conv: "conv:test:chat", data: { text: id, threadId } },
			original: { messageId: id },
		});
		const ordered = [
			message("A1", "a"),
			message("B2", "b"),
			message("A3", "a"),
			message("A4", "a", "thread"),
			message("A5", "a", "thread"),
			message("A6", "a"),
		];
		const batches = recoveryBatches(ordered);
		expect(batches.map((batch) => batch.map((row) => row.key))).toEqual([["A1"], ["B2"], ["A3"], ["A4", "A5"], ["A6"]]);
		expect(batches.flat().map((row) => row.key)).toEqual(ordered.map((row) => row.key));
	});
	it("scans old roots and paged replies, merges by sender, and reuses durable IDs on redelivery", async () => {
		const { channel, internal, emitted, root } = await harness();
		const calls: URLSearchParams[] = [];
		vi.spyOn(channel.client, "request").mockImplementation(async (path) => {
			if (path.startsWith("/im/v1/chats?")) return { data: { items: [{ chat_id: "chat" }] } };
			const params = new URL(path, "https://feishu.invalid").searchParams;
			calls.push(params);
			if (params.get("container_id_type") === "chat")
				return {
					data: { items: [item("old-root", 500, "user-a", { thread_id: "thread" }), item("a", 1100)], has_more: false },
				};
			if (!params.has("page_token"))
				return {
					data: {
						items: [item("reply-a", 1200, "user-a", { thread_id: "thread" })],
						has_more: true,
						page_token: "next",
					},
				};
			return { data: { items: [item("reply-b", 1300, "user-b", { thread_id: "thread" })] } };
		});
		await internal.catchup();
		expect(emitted).toHaveLength(3);
		expect(
			emitted.map((input) =>
				(input.data as { originals: { messageId: string }[] }).originals.map((row) => row.messageId),
			),
		).toEqual([["a"], ["reply-a"], ["reply-b"]]);
		expect(calls.some((params) => params.get("page_token") === "next")).toBe(true);
		expect(
			calls.filter((params) => params.get("container_id_type") === "chat").every((params) => !params.has("start_time")),
		).toBe(true);
		const saved = JSON.parse(await readFile(join(root, "test", "history.json"), "utf8"));
		expect(saved.conversations[0].through).toBeGreaterThan(1300);
		await internal.receive({
			sender: { sender_type: "user", sender_id: { open_id: "user-a" }, tenant_key: "tenant" },
			message: {
				message_id: "reply-a",
				chat_id: "chat",
				chat_type: "group",
				message_type: "text",
				content: '{"text":"redelivery"}',
			},
		});
		expect(emitted).toHaveLength(3);
		await channel.stop();
	});
	it("holds live redeliveries behind ready recovery without deadlocking the ingestion tail", async () => {
		const { channel, internal, emitted } = await harness();
		internal.conversations.clear();
		let releaseBot: () => void = () => {};
		const botGate = new Promise<void>((resolve) => {
			releaseBot = resolve;
		});
		vi.spyOn(channel.client, "request").mockImplementation(async (path) => {
			if (path === "/bot/v3/info") {
				await botGate;
				return { bot: { open_id: "bot" } };
			}
			if (path.startsWith("/im/v1/chats?")) return { data: { items: [] } };
			return { data: { items: [item("a", 1100), item("b", 1200)] } };
		});
		const live = (id: string) =>
			internal.receive({
				sender: { sender_type: "user", sender_id: { open_id: "user-a" }, tenant_key: "tenant" },
				message: {
					message_id: id,
					chat_id: "chat",
					chat_type: "p2p",
					message_type: "text",
					content: JSON.stringify({ text: id }),
				},
			});
		const ready = internal.ready();
		const first = live("a"),
			second = live("b"),
			duplicate = live("a");
		await Promise.resolve();
		expect(emitted).toHaveLength(0);
		expect(internal.conversations.get("chat")?.kind).toBe("dm");
		releaseBot();
		await Promise.all([ready, first, second, duplicate]);
		expect(emitted).toHaveLength(1);
		expect(emitted[0].data).toMatchObject({ recovery: true, originals: [{ messageId: "a" }, { messageId: "b" }] });
		await live("a");
		expect(emitted).toHaveLength(1);
		await live("after-cutoff");
		expect(emitted).toHaveLength(2);
		await channel.stop();
	});
	it("rejects a cross-chat recovery page before content or resources are prepared", async () => {
		const { channel, internal, emitted } = await harness();
		vi.spyOn(channel.client, "request").mockImplementation(async (path) => {
			if (path.startsWith("/im/v1/chats?")) return { data: { items: [] } };
			return {
				data: {
					items: [
						item("foreign", 1200, "user-a", {
							chat_id: "another",
							msg_type: "image",
							body: { content: '{"image_key":"resource"}' },
						}),
					],
				},
			};
		});
		const raw = vi.spyOn(channel.client, "raw");
		await internal.catchup();
		expect(emitted).toHaveLength(0);
		expect(raw).not.toHaveBeenCalled();
		expect(internal.conversations.get("chat")?.through).toBe(1000);
		expect(channel.status()).toMatchObject({ recovery: { state: "incomplete" } });
		await channel.stop();
	});
	it("keeps failed conversation watermarks and exposes incomplete recovery", async () => {
		const { channel, internal, root } = await harness();
		vi.spyOn(channel.client, "request").mockImplementation(async (path) => {
			if (path.startsWith("/im/v1/chats?")) return { data: { items: [] } };
			throw new Error("scope denied");
		});
		await internal.catchup();
		expect(channel.status()).toMatchObject({ recovery: { state: "incomplete", privateChats: "known-only" } });
		const saved = JSON.parse(await readFile(join(root, "test", "history.json"), "utf8"));
		expect(saved.conversations[0].through).toBe(1000);
		await channel.stop();
	});
	it("recovers originals from the event ledger when receipts were lost", async () => {
		const ledger: YEvent[] = [
			{
				id: "durable",
				ts: new Date().toISOString(),
				type: "message.in",
				from: "acct:test:user-a",
				conv: "conv:test:chat",
				data: {
					kind: "dm",
					tenant: "tenant",
					msgId: "recovery:batch",
					originals: [{ messageId: "already", tenant: "tenant" }],
				},
			},
		];
		const { channel, internal, emitted } = await harness(ledger);
		await internal.receive({
			sender: { sender_type: "user", sender_id: { open_id: "user-a" }, tenant_key: "tenant" },
			message: {
				message_id: "already",
				chat_id: "chat",
				chat_type: "p2p",
				message_type: "text",
				content: '{"text":"again"}',
			},
		});
		expect(emitted).toHaveLength(0);
		await channel.stop();
	});
	it("checks returned chat identity before resolving a cross-source thread", async () => {
		const { channel } = await harness();
		vi.spyOn(channel.client, "request").mockResolvedValue({
			data: { items: [item("foreign", 1200, "user-a", { chat_id: "another" })] },
		});
		await expect(channel.history({ chat: "chat", thread: "foreign" }, new AbortController().signal)).rejects.toThrow(
			"different source",
		);
		await channel.stop();
	});
});
