import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolContext } from "@yonder/sdk";
import { expect, test } from "vitest";
import { openDatabase } from "../runtime/db.js";
import { localEnvironment } from "../runtime/env.js";
import { createStore } from "../store/index.js";
import { conversationMembers, createConversationTools, sourceConversation } from "./conversation.js";

test("conversation tools read SQLite history, preserve scope, and open only referenced text attachments", async () => {
	const home = await mkdtemp(join(tmpdir(), "yonder-conversation-"));
	const db = await openDatabase(":memory:");
	try {
		const store = await createStore(db);
		const event = await store.events.record({
			type: "message.in",
			from: "acct:qq:alice",
			conv: "conv:qq:group:a",
			data: {
				text: "Windows requirement",
				name: "Alice",
				attachments: [{ kind: "file", mime: "text/markdown", name: "windows.md", uri: "https://example.invalid/file" }],
			},
		});
		const foreign = await store.events.record({
			type: "message.in",
			from: "acct:qq:bob",
			conv: "conv:qq:group:b",
			data: { text: "private" },
		});
		await store.events.record({
			type: "message.out",
			from: "agent:main",
			conv: event.conv!,
			data: { text: "sent", delivery: { ok: true, id: "native-out" } },
		});
		await store.events.record({
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
		expect((await conversationMembers(store, event.conv!, "main")).members.map((m) => m.ref)).toEqual([
			"acct:qq:alice",
			"agent:main",
		]);
		expect(() => sourceConversation({ ...ctx, events: [event, foreign] })).toThrow("唯一来源");
		await mkdir(join(home, ".yonder/attachments"), { recursive: true });
		await writeFile(join(home, ".yonder/attachments", `${event.id}-0`), "Windows support\nMake setup easy");
		const attachment = tools.find((t) => t.name === "conversation_attachment_read")!;
		const result = await attachment.execute({ message: event.id, attachment: 0, offset: 0, limit: 7 }, ctx);
		expect(JSON.parse(result.text)).toMatchObject({ text: "Windows", next: 7 });
		expect((await attachment.execute({ message: foreign.id, attachment: 0 }, ctx)).isError).toBe(true);
		expect((await read.execute({}, { ...ctx, capabilities: [] })).isError).toBe(true);
	} finally {
		await db.close();
		await rm(home, { recursive: true, force: true });
	}
});
