import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionUpdate } from "@yonder/sdk";
import { expect, test } from "vitest";
import { resolveProfile } from "../config/test-support.js";
import { createSessions } from "../sessions/index.js";
import { createStore } from "../store/index.js";
import { openDatabase } from "./db.js";
import { Runtime, readTranscript } from "./index.js";

test("native program notifications persist once without model messages and replay in transcript order", async () => {
	const home = await mkdtemp(join(tmpdir(), "yonder-notifications-"));
	const path = join(home, "state.db");
	let runtime: Runtime | undefined;
	let stop: (() => Promise<void>) | undefined;
	try {
		const db = await openDatabase(path);
		const store = await createStore(db);
		let runs = 0;
		const options = {
			home,
			config: { schema: 1 as const },
			resolveSession: async () => ({ agent: null, profile: "default", cwd: home, resolved: resolveProfile({}) }),
			onRun: async () => {
				runs++;
			},
		};
		runtime = await Runtime.open({ ...options, db });
		const current = runtime;
		const sessions = createSessions({
			store,
			home,
			config: { schema: 1 },
			version: "notification-check",
			agents: new Map(),
			pluginPresets: new Map(),
			homePresets: new Map([["default", { id: "default", description: "Native notification check" }]]),
			runtime: () => current,
		});
		const session = await sessions.api.open({ preset: "default", close: "manual" });
		const event = await store.events.record({ type: "notification.check", from: "plugin:verification", data: {} });
		const updates: SessionUpdate[] = [];
		stop = await runtime.observe(session.id, async (update) => {
			updates.push(update);
		});
		expect(await runtime.notificationRecorded(session.id, "plugin:verification", event.id)).toBe(false);
		const receipt = await sessions.notifyFrom(
			session.id,
			{ event: event.id, text: "Native storage checked" },
			"plugin:verification",
		);
		expect(await runtime.notificationRecorded(session.id, "plugin:verification", event.id)).toBe(true);
		expect(receipt).toEqual({ session: session.id, event: event.id, entry: expect.any(Number), recorded: true });
		expect(
			await sessions.notifyFrom(
				session.id,
				{ event: event.id, text: "Different repeated text" },
				"plugin:verification",
			),
		).toEqual(receipt);
		await expect.poll(() => updates.filter((update) => update.type === "notification").length).toBe(1);
		expect(updates.some((update) => update.type === "state" && update.running)).toBe(false);
		expect(runs).toBe(0);
		const entries = await db.all<{ record: string }>(
			"SELECT record FROM pi_entries WHERE conversation_id = ?",
			Number(session.id),
		);
		expect(entries).toHaveLength(1);
		const saved = entries[0];
		if (!saved) throw new Error("Native notification entry missing");
		expect(JSON.parse(saved.record)).toMatchObject({
			kind: "yonder.notification",
			data: { from: "plugin:verification", event: event.id, text: "Native storage checked" },
		});
		expect(JSON.parse(saved.record).model).toBeUndefined();
		await expect(
			sessions.notifyFrom(session.id, { event: "missing", text: "reject" }, "plugin:verification"),
		).rejects.toThrow("Unknown notification event");
		await expect(
			sessions.notifyFrom("missing", { event: event.id, text: "reject" }, "plugin:verification"),
		).rejects.toThrow("Not an open session");
		await runtime.submit(session.id, { text: "Native passive input check", wake: "write" });
		await sessions.api.close(session.id);
		await expect(
			sessions.notifyFrom(session.id, { event: event.id, text: "reject closed" }, "plugin:verification"),
		).rejects.toThrow("Not an open session");
		const online = await runtime.transcript(session.id);
		expect(online[0]).toMatchObject({
			kind: "yonder.notification",
			text: "Native storage checked",
			from: "plugin:verification",
			event: event.id,
		});
		await stop();
		stop = undefined;
		await runtime.close();
		runtime = undefined;
		const offline = await openDatabase(path, true);
		try {
			expect(await readTranscript(offline, session.id)).toEqual(online);
		} finally {
			await offline.close();
		}
		runtime = await Runtime.open({ ...options, db: await openDatabase(path) });
		const replay: SessionUpdate[] = [];
		stop = await runtime.observe(session.id, async (update) => {
			replay.push(update);
		});
		expect(replay[0]?.items?.map((item) => (item.notification ? "notification" : "message"))).toEqual([
			"notification",
			"message",
		]);
		expect(replay[0]?.items?.[0]?.notification).toMatchObject({
			id: receipt.entry,
			from: "plugin:verification",
			event: event.id,
		});
		expect(await runtime.usage(session.id)).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 });
	} finally {
		await stop?.();
		await runtime?.close();
		await rm(home, { recursive: true, force: true });
	}
});

test("an attachment-only notification is recorded while an empty one still fails", async () => {
	const home = await mkdtemp(join(tmpdir(), "yonder-notifications-media-"));
	const path = join(home, "state.db");
	let runtime: Runtime | undefined;
	try {
		const db = await openDatabase(path);
		const store = await createStore(db);
		const options = {
			home,
			config: { schema: 1 as const },
			resolveSession: async () => ({ agent: null, profile: "default", cwd: home, resolved: resolveProfile({}) }),
			onRun: async () => {},
		};
		runtime = await Runtime.open({ ...options, db });
		const current = runtime;
		const sessions = createSessions({
			store,
			home,
			config: { schema: 1 },
			version: "notification-check",
			agents: new Map(),
			pluginPresets: new Map(),
			homePresets: new Map([["default", { id: "default", description: "Native notification check" }]]),
			runtime: () => current,
		});
		const session = await sessions.api.open({ preset: "default", close: "manual" });
		const attachment = { kind: "image" as const, mime: "image/png", uri: "file:///tmp/board.png", name: "board.png" };
		// 控制台没有传输层：persistConsole 引用的就是投递尝试事件，附件在 outgoing 里。
		const media = await store.events.record({
			type: "message.attempt",
			from: "agent:main",
			conv: "conv:console:main",
			data: {
				target: "conv:console:main",
				method: "send",
				outgoing: { to: "conv:console:main", text: "", attachments: [attachment] },
			},
		});
		expect(await sessions.notifyFrom(session.id, { event: media.id, text: "" }, "agent:main")).toMatchObject({
			session: session.id,
			event: media.id,
			recorded: true,
		});
		expect((await runtime.transcript(session.id))[0]).toMatchObject({ kind: "yonder.notification", text: "" });
		const empty = await store.events.record({
			type: "message.out",
			from: "agent:main",
			conv: "conv:console:main",
			data: { to: "conv:console:main", text: "", delivery: { ok: true } },
		});
		await expect(sessions.notifyFrom(session.id, { event: empty.id, text: "" }, "agent:main")).rejects.toThrow(
			"Notification requires an event and text or an attachment",
		);
		await sessions.api.close(session.id);
	} finally {
		await runtime?.close();
		await rm(home, { recursive: true, force: true });
	}
});
