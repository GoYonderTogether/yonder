import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EntryRecord } from "@earendil-works/pi-durable";
import { expect, test } from "vitest";
import { resolveProfile } from "../../../packages/core/src/config/test-support";
import { prepareInput } from "../../../packages/core/src/prompt";
import { Runtime } from "../../../packages/core/src/runtime";
import { FileCredentials } from "../../../packages/core/src/runtime/credentials";
import { openDatabase } from "../../../packages/core/src/runtime/db";
import { localEnvironment, workspaceFiles } from "../../../packages/core/src/runtime/env";
import { buildModels } from "../../../packages/core/src/runtime/models";
import { readTranscript, transcriptItem } from "../../../packages/core/src/runtime/transcript";
import { createStore } from "../../../packages/core/src/store";
import { fromTranscript, timeBucket } from "../src/work/lib/chat";
import { emptyView, reduce } from "../src/work/lib/useSession";

test("real preparation and stored edit project metadata without losing the original or page boundary", async () => {
	const home = await mkdtemp(join(tmpdir(), "yonder-transcript-ui-"));
	const db = await openDatabase(join(home, "state.db"));
	let runtime: Runtime | undefined;
	try {
		const store = await createStore(db);
		const text = "保留正文\n<turn>这是用户写的 XML</turn>";
		const event = await store.events.record({ type: "message.in", from: "acct:console:owner", data: { text } });
		const session = { agent: null, profile: "default", cwd: home, resolved: resolveProfile({ contexts: ["context"] }) };
		runtime = await Runtime.open({ db, home, config: { schema: 1 }, resolveSession: async () => session });
		const id = await runtime.create({ agent: null, profile: "default", cwd: home });
		await runtime.submit(id, { text, event, wake: "write" });
		const [original] = await runtime.transcript(id);
		if (!original) throw new Error("missing original input");
		const prepared = await prepareInput(
			{ id, agent: null, profile: "default", mode: "task", key: "check", version: "check", opened: event.ts },
			session,
			event,
			"write",
			{
				home,
				version: "check",
				locale: "zh-CN",
				timezone: "UTC",
				contexts: new Map([["context", { id: "context", placement: "turn", render: () => "真实上下文贡献" }]]),
				workspace: () => workspaceFiles(localEnvironment(home)),
				identity: store.identity(),
				models: buildModels(new FileCredentials(join(home, "auth.json"))),
				setVersion: store.sessions.setVersion,
			},
		);
		// The durable edit is the actual persisted shape, and uses the real prompt preparer above.
		const entry = {
			id: original.id + 1,
			conversationId: Number(id),
			kind: "yonder.prepared",
			data: { target: original.id },
			edits: [
				{
					target: original.id,
					action: "replace",
					messages: [{ role: "user", content: prepared.text, timestamp: Date.now() }],
				},
			],
		} as unknown as EntryRecord;
		await db.run(
			"INSERT INTO pi_entries (id, conversation_id, commit_seq, record) VALUES (?, ?, (SELECT max(commit_seq) FROM pi_entries), ?)",
			Number(entry.id),
			Number(id),
			JSON.stringify(entry),
		);
		expect(transcriptItem(entry).target).toBe(original.id);
		const page = await runtime.transcript(id, { before: Number(entry.id), limit: 1 });
		expect(page).toHaveLength(1);
		expect(page[0]?.prepared).toBe(prepared.text);
		const [item] = fromTranscript(page);
		expect(item?.text).toBe(text);
		expect(item?.metadata?.map((part) => part.label)).toEqual(["消息来源", "上下文注入"]);
		expect(item?.metadata?.at(-1)?.text).toBe("真实上下文贡献");
		expect(item?.from).toBe("acct:console:owner");
		expect(await readTranscript(db, id, { from: original.id, limit: 1 })).toEqual(page);
		const ready = reduce(emptyView, {
			k: "snapshot",
			gap: true,
			stream: true,
			snap: { transcript: { items: page, hasMore: false } },
		});
		const raw = await db.get<{ record: string }>("SELECT record FROM pi_entries WHERE id = ?", original.id);
		const native = JSON.parse(raw!.record) as EntryRecord;
		const snapshot = {
			k: "ev" as const,
			type: "session.update",
			data: {
				type: "snapshot",
				items: (native.model ?? []).map((message, index) => ({ id: `${native.id}:${index}`, message })),
			},
		};
		const afterNative = reduce(ready, snapshot);
		expect(afterNative.items).toEqual(ready.items);
		expect(reduce(afterNative, snapshot).items).toEqual(ready.items);
	} finally {
		await runtime?.close();
		await rm(home, { recursive: true, force: true });
	}
});

test("raw input XML stays visible, and time buckets split at five minutes or a date change", () => {
	const text = '<turn channel="qq">用户正文</turn>\n继续';
	expect(fromTranscript([{ id: 1, kind: "yonder.message", text }])[0]?.text).toBe(text);
	const start = new Date(2026, 9, 30, 12, 0).getTime();
	expect(timeBucket(start + 299_999, start)).toBeUndefined();
	expect(timeBucket(start + 300_000, start)).toBeTruthy();
	expect(timeBucket(new Date(2026, 9, 31).getTime(), new Date(2026, 9, 30, 23, 59).getTime())).toBeTruthy();
});
