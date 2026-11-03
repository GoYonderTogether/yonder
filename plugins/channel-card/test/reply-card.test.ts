import { rm } from "node:fs/promises";
import type { PluginAPI, ToolContext, YEvent } from "@yonder/sdk";
import { createFilePluginStorage, createRegistrationCollector, tempHome } from "@yonder/sdk/testing";
import { afterEach, expect, test } from "vitest";
import plugin from "../src/index.js";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function fixture() {
	const data = await tempHome("yonder-card-reply-card-");
	cleanups.push(() => rm(data, { recursive: true, force: true }));
	const collector = createRegistrationCollector();
	const api = Object.assign(collector.api, {
		storage: createFilePluginStorage(data),
		log: { info() {}, warn() {}, error() {} },
	}) as unknown as PluginAPI;
	await plugin.setup(api);
	const channel = collector.registrations.channels[0];
	if (!channel) throw new Error("card channel was not registered");
	await channel.create("card-local", {});
	const tool = collector.registrations.tools.find((item) => item.name === "channel-card_reply_card");
	const hook = collector.registrations.hooks.find((item) => item.id === "channel-card-reply-card");
	if (!tool || !hook) throw new Error("reply card registrations missing");
	const files = api.storage.open();
	const source = (): YEvent => ({
		id: "source-event-1",
		type: "message.in",
		ts: new Date(0).toISOString(),
		from: "acct:card-local:main:person-1",
		conv: "conv:card-local:main:room-1",
		data: { kind: "dm", target: "main", msgId: "message-1", text: "please connect" },
		routes: [{ agent: "main", session: "session-1", binding: "card-dm", waiting: false }],
	});
	const context = (event: YEvent | null = source(), overrides: object = {}) =>
		({
			agent: "main",
			profile: "default",
			session: "session-1",
			runId: "run-1",
			autoReplySource: event?.id,
			capabilities: ["message"],
			channelInstances: ["card-local"],
			...(event ? { event, events: [event] } : { events: [] }),
			env: { id: "node:local" },
			signal: new AbortController().signal,
			...overrides,
		}) as unknown as ToolContext;
	return { api, registrations: collector.registrations, files, tool, hook, source, context };
}

const card = (
	title: string,
	actions = [
		{ id: "connect", label: "连接设备", link: "/connect" },
		{ id: "download", label: "安装客户端", link: "/download" },
	],
) => ({
	title,
	body: "准备在当前对话中结束回复。",
	actions,
	link: "/download",
});

test("reply card accepts only current in-scope card source and application links", async () => {
	const f = await fixture();
	expect(f.tool.capabilities).toEqual(["message"]);
	expect(f.tool.guidelines).toEqual([
		"When a request needs a device connection or client installation, prepare an interactive card with the relevant buttons instead of giving only a textual instruction.",
		"Use /connect for a device connection and /download for client installation; put each action's own application link on its button.",
		"This tool only prepares the current conversation's final card. Finish normally after preparation; do not send a second message to the same source or use NO_REPLY, and do not claim the card has already been delivered.",
	]);
	const noSource = await f.tool.execute(card("连接"), f.context(null));
	expect(noSource.isError).toBe(true);
	expect((await f.tool.execute(card("连接"), f.context(f.source(), { agent: null }))).isError).toBe(true);
	expect((await f.tool.execute(card("连接"), f.context(f.source(), { runId: undefined }))).isError).toBe(true);
	expect((await f.tool.execute(card("连接"), f.context(f.source(), { capabilities: [] }))).isError).toBe(true);
	expect((await f.tool.execute(card("连接"), f.context(f.source(), { autoReplySource: undefined }))).isError).toBe(
		true,
	);
	for (const field of ["to", "owner", "profile", "runId"]) {
		expect((await f.tool.execute({ ...card("连接"), [field]: "caller-controlled" }, f.context())).isError).toBe(true);
	}
	const otherCurrent = f.source();
	otherCurrent.conv = "conv:card-local:main:other-room";
	expect((await f.tool.execute(card("连接"), f.context(f.source(), { event: otherCurrent }))).isError).toBe(true);
	expect((await f.tool.execute(card("连接"), f.context(f.source(), { autoReplySource: "other-event" }))).isError).toBe(
		true,
	);
	const wrongScope = await f.tool.execute(card("连接"), f.context(f.source(), { channelInstances: ["other"] }));
	expect(wrongScope.isError).toBe(true);
	const waiting = f.source();
	const waitingRoute = waiting.routes?.[0];
	if (!waitingRoute) throw new Error("source route missing");
	waitingRoute.waiting = true;
	expect((await f.tool.execute(card("连接"), f.context(waiting))).isError).toBe(true);
	delete waitingRoute.waiting;
	expect((await f.tool.execute(card("连接"), f.context(waiting))).isError).toBe(true);
	const forged = await f.tool.execute({ ...card("连接"), to: "conv:card-local:main:elsewhere" }, f.context());
	expect(forged.isError).toBe(true);
	for (const link of [
		"https://example.com",
		"//example.com/path",
		"javascript:alert(1)",
		"relative/path",
		"/\\example.com",
	]) {
		const result = await f.tool.execute(card("连接", [{ id: "bad", label: "坏链接", link }]), f.context());
		expect(result.isError).toBe(true);
		expect((await f.tool.execute({ ...card("连接"), link }, f.context())).isError).toBe(true);
	}
	const valid = await f.tool.execute(card("连接"), f.context());
	expect(valid).toEqual({ text: "交互卡片已准备，尚未发送。请正常结束本轮，不要再发送第二条消息。" });
});

test("last successful card overwrites one run intent and only its matching successful final is replaced", async () => {
	const f = await fixture();
	await f.tool.execute(card("第一张"), f.context());
	await f.tool.execute(card("最终卡片"), f.context());
	const path = "replies/session-1/run-1.json";
	const raw = await f.files.read(path);
	if (raw === undefined) throw new Error("reply card intent was not persisted");
	const stored = JSON.parse(raw);
	expect(stored).toMatchObject({
		state: "pending",
		title: "最终卡片",
		session: "session-1",
		runId: "run-1",
		sourceEventId: "source-event-1",
		conv: "conv:card-local:main:room-1",
		msgId: "message-1",
	});
	const candidate = { to: "conv:card-local:main:room-1", text: "model final", sourceMessageId: "message-1" };
	const match = await f.hook.beforeSend?.(
		candidate,
		{ session: "session-1", agent: "main", profile: "default" },
		{ runId: "run-1", status: "done", sourceEventId: "source-event-1" },
	);
	expect(match?.message).toMatchObject({
		to: candidate.to,
		text: "最终卡片\n\n准备在当前对话中结束回复。",
		content: {
			type: "interactive",
			title: "最终卡片",
			state: "pending",
			actions: [
				{ id: "connect", label: "连接设备", link: "/connect" },
				{ id: "download", label: "安装客户端", link: "/download" },
			],
			link: "/download",
		},
	});
	for (const [owner, final, to] of [
		[
			{ session: "other", agent: "main", profile: "default" },
			{ runId: "run-1", status: "done", sourceEventId: "source-event-1" },
			candidate.to,
		],
		[
			{ session: "session-1", agent: "other", profile: "default" },
			{ runId: "run-1", status: "done", sourceEventId: "source-event-1" },
			candidate.to,
		],
		[
			{ session: "session-1", agent: "main", profile: "default" },
			{ runId: "other-run", status: "done", sourceEventId: "source-event-1" },
			candidate.to,
		],
		[
			{ session: "session-1", agent: "main", profile: "default" },
			{ runId: "run-1", status: "error", sourceEventId: "source-event-1" },
			candidate.to,
		],
		[
			{ session: "session-1", agent: "main", profile: "default" },
			{ runId: "run-1", status: "done", sourceEventId: "other-event" },
			candidate.to,
		],
		[
			{ session: "session-1", agent: "main", profile: "default" },
			{ runId: "run-1", status: "done", sourceEventId: "source-event-1" },
			"conv:card-local:main:other-room",
		],
	] as const) {
		expect(await f.hook.beforeSend?.({ ...candidate, to }, owner, final)).toBeUndefined();
	}
	// Preparing never deletes the intent. It is retained until the complete interactive outgoing is durable.
	expect(await f.files.read(path)).toBeDefined();
});

test("message attempt removes only the persisted matching card; non-done run end clears its pending intent", async () => {
	const f = await fixture();
	await f.tool.execute(card("最终卡片"), f.context());
	const path = "replies/session-1/run-1.json";
	const prepared = await f.hook.beforeSend?.(
		{ to: "conv:card-local:main:room-1", text: "", sourceMessageId: "message-1" },
		{ session: "session-1", agent: "main", profile: "default" },
		{ runId: "run-1", status: "done", sourceEventId: "source-event-1" },
	);
	const attempt = f.registrations.listeners.find((item) => item.type === "message.attempt")?.handler;
	const end = f.registrations.listeners.find((item) => item.type === "run.end")?.handler;
	if (!attempt || !end || !prepared) throw new Error("reply card cleanup hooks missing");
	await attempt({
		id: "attempt-1",
		ts: new Date().toISOString(),
		type: "message.attempt",
		data: {
			session: "session-1",
			runId: "run-1",
			target: "conv:card-local:main:room-1",
			from: "agent:main",
			outgoing: { ...prepared.message, content: { type: "interactive", title: "partial" } },
		},
	} as unknown as YEvent);
	expect(await f.files.read(path)).toBeDefined();
	await attempt({
		id: "attempt-2",
		ts: new Date().toISOString(),
		type: "message.attempt",
		data: {
			session: "session-1",
			runId: "run-1",
			target: "conv:card-local:main:room-1",
			from: "agent:main",
			outgoing: prepared.message,
		},
	} as unknown as YEvent);
	expect(await f.files.read(path)).toBeUndefined();

	await f.tool.execute(card("待清除"), f.context());
	await end({
		id: "end-1",
		ts: new Date().toISOString(),
		type: "run.end",
		data: { session: "session-1", runId: "run-1", status: "aborted" },
	} as YEvent);
	expect(await f.files.read(path)).toBeUndefined();
});
