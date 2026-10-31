import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EventInput, ToolContext } from "@yonder/sdk";
import { expect, test } from "vitest";
import { openDatabase } from "../runtime/db.js";
import { localEnvironment } from "../runtime/env.js";
import { createStore, newEvent } from "../store/index.js";
import { conversationMembers, createConversationTools, sourceConversation } from "./conversation.js";

test("conversation tools read SQLite history, preserve scope, and open only referenced text attachments", async () => {
	const home = await mkdtemp(join(tmpdir(), "yonder-conversation-"));
	const db = await openDatabase(":memory:");
	try {
		const store = await createStore(db);
		// 明确的递增时间戳：成员按最近发言时间倒序，同一毫秒只由引用名决定先后，不能让夹具靠运气。
		let tick = Date.parse("2026-10-31T00:00:00.000Z");
		const record = (input: EventInput) => {
			tick += 1000;
			return store.events.append({ ...newEvent(input), ts: new Date(tick).toISOString() });
		};
		const event = await record({
			type: "message.in",
			from: "acct:qq:alice",
			conv: "conv:qq:group:a",
			data: {
				text: "Windows requirement",
				name: "Alice",
				attachments: [{ kind: "file", mime: "text/markdown", name: "windows.md", uri: "https://example.invalid/file" }],
			},
		});
		const foreign = await record({
			type: "message.in",
			from: "acct:qq:bob",
			conv: "conv:qq:group:b",
			data: { text: "private" },
		});
		await record({
			type: "message.out",
			from: "agent:main",
			conv: event.conv!,
			data: { text: "sent", delivery: { ok: true, id: "native-out" } },
		});
		await record({
			type: "message.out",
			from: "agent:main",
			conv: event.conv!,
			data: { text: "failed", delivery: { ok: false } },
		});
		const ctx: ToolContext = {
			agent: "main",
			profile: "group",
			session: "1",
			capabilities: ["read"],
			env: localEnvironment(home),
			event,
			signal: new AbortController().signal,
		};
		const tools = createConversationTools(store, home);
		const read = tools.find((t) => t.name === "conversation_read")!;
		const history = JSON.parse((await read.execute({}, ctx)).text);
		expect(history.messages.map((m: { text: string }) => m.text)).toEqual(["Windows requirement", "sent"]);
		expect(JSON.parse((await read.execute({ id: foreign.id }, ctx)).text).messages).toEqual([]);
		// 成员按最近一次发言时间倒序，且有界；平台没有完整成员表，这里只报观察到的。
		expect((await conversationMembers(store, event.conv!, "main")).members.map((m) => m.ref)).toEqual([
			"agent:main",
			"acct:qq:alice",
		]);
		expect(() => sourceConversation({ ...ctx, events: [event, foreign] })).toThrow("唯一来源");
		await mkdir(join(home, ".yonder/attachments"), { recursive: true });
		await writeFile(join(home, ".yonder/attachments", `${event.id}-0`), "Windows support\nMake setup easy");
		const attachment = tools.find((t) => t.name === "conversation_attachment_read")!;
		const result = await attachment.execute({ message: event.id, attachment: 0, offset: 0, limit: 7 }, ctx);
		expect(JSON.parse(result.text)).toMatchObject({ text: "Windows", next: 7 });
		expect((await attachment.execute({ message: foreign.id, attachment: 0 }, ctx)).isError).toBe(true);
		expect((await read.execute({}, { ...ctx, capabilities: [] })).isError).toBe(true);
		const incomplete = await store.events.record({
			type: "message.in",
			conv: "conv:qq:group:a",
			data: {
				text: "",
				attachments: [
					{
						kind: "file",
						mime: "text/plain",
						name: "document.txt",
						bytes: 100,
						uri: "https://example.invalid/expired",
					},
				],
			},
		});
		await writeFile(join(home, ".yonder/attachments", `${incomplete.id}-0`), "incomplete");
		expect(await attachment.execute({ message: incomplete.id, attachment: 0 }, ctx)).toMatchObject({
			isError: true,
			text: expect.stringContaining("大小与消息附件元数据不一致"),
		});
	} finally {
		await db.close();
		await rm(home, { recursive: true, force: true });
	}
});
