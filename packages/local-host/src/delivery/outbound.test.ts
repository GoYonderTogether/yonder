import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createTriggerScheduler } from "@yonder/sdk/trigger-scheduler";
import { expect, test, vi } from "vitest";

const shape = (value: unknown): unknown =>
	Array.isArray(value)
		? [shape(value[0])]
		: value && typeof value === "object"
			? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, shape(item)]))
			: typeof value;

import { outboundQueue } from "@yonder/bot-core/delivery/outbound";
import { socialPluginHooks } from "@yonder/local-host/kernel/social-plugin.test-support";

// 真实加载官方 social 插件：主动通知准入读的是它给出的判定（04 §3.6）。
const participationHooks = await socialPluginHooks();

test("digest survives restart and rechecks every queued owner's capability", async () => {
	const events: Array<{ id: string; type: string; ts: string; data: unknown }> = [];
	const agent = { social: { enabled: true }, owner: "person:owner" };
	const agents = new Map([["bot", agent]]);
	let allowed = true;
	const notices: string[] = [];
	const store = {
		events: {
			query: async ({ type }: { type: string }) => ({ events: events.filter((e) => e.type === type) }),
			get: async (id: string) => events.find((e) => e.id === id),
			record: async (input: { type: string; data: unknown }) => {
				const event = { ...input, id: String(events.length + 1), ts: new Date(0).toISOString() };
				events.push(event);
				return event;
			},
		},
		sessions: {
			get: async (id: string) => ({ id, agent: "bot", profile: "main" }),
			list: async () => [{ id: "main" }],
		},
	};
	const sessions = {
		resolveSession: async () => ({ resolved: { capabilities: allowed ? ["message"] : [] } }),
		notifyFrom: async (_id: string, input: { text: string }) => {
			notices.push(input.text);
		},
	};
	const args = {
		store,
		sessions,
		agents,
		config: { notifications: { outbound: { mode: "immediate" } } },
		delivery: () => ({}),
		participationHooks,
	} as unknown as Parameters<typeof outboundQueue>[0];
	await store.events.record({ type: "source", data: {} });
	const owner = { agent: "bot", session: "1", profile: "main" };
	const queue = outboundQueue(args);
	const scheduler = createTriggerScheduler(() => {});
	const scheduled = vi.spyOn(globalThis, "setTimeout");
	const cleared = vi.spyOn(globalThis, "clearTimeout");
	try {
		await queue.start(scheduler);
		expect(scheduled).not.toHaveBeenCalled();
		await queue.enqueue(owner, "tasks", "需要决定", { kind: "decision", key: "task:1", sourceEvents: ["1"] });
		const timer = scheduled.mock.results.at(-1)!.value;
		await outboundQueue(args).flush();
		await queue.flush();
		expect(cleared).toHaveBeenCalledWith(timer);
		expect(notices).toEqual(["需要决定"]);
		await queue.enqueue(owner, "tasks", "已撤权", { kind: "decision", key: "task:2", sourceEvents: ["1"] });
		allowed = false;
		await queue.flush();
		allowed = true;
		await queue.flush();
		expect(notices).toEqual(["需要决定"]);
		const actual = Object.fromEntries(
			["notification.intent", "notification.final"].map((type) => [
				type,
				shape(events.find((event) => event.type === type)?.data),
			]),
		);
		const golden = new URL("./outbound.golden.json", import.meta.url);
		if (process.env.UPDATE_GOLDEN === "1") {
			writeFileSync(golden, `${JSON.stringify(actual, null, "\t")}\n`);
			execFileSync("npx", ["biome", "format", "--write", fileURLToPath(golden)]);
		}
		expect(actual).toEqual(JSON.parse(readFileSync(golden, "utf8")));
	} finally {
		await queue.stop();
		await scheduler.stop();
		scheduled.mockRestore();
		cleared.mockRestore();
	}
});

test("the console stays an allowed owner notification target under a channel scope", async () => {
	const events: Array<{ id: string; type: string; ts: string; data: unknown }> = [];
	const agent = {
		social: { enabled: true, authorized: { conversations: ["conv:console:main"] } },
		owner: "person:owner",
	};
	const sent: Array<{ to: string; text: string }> = [];
	const store = {
		events: {
			query: async ({ type }: { type: string }) => ({ events: events.filter((e) => e.type === type) }),
			get: async (id: string) => events.find((e) => e.id === id),
			record: async (input: { type: string; data: unknown }) => {
				const event = { ...input, id: String(events.length + 1), ts: new Date(0).toISOString() };
				events.push(event);
				return event;
			},
		},
		sessions: { get: async (id: string) => ({ id, agent: "bot", profile: "main" }) },
	};
	const sessions = {
		// 主人的控制台是内部渠道：档位限定 feishu 也不影响它。
		resolveSession: async () => ({ resolved: { capabilities: ["message"], channelInstances: ["feishu"] } }),
		notifyFrom: async () => {},
	};
	const delivery = {
		sendOwned: async (_plugin: string, request: { to: string; text: string }) => {
			sent.push({ to: request.to, text: request.text });
			return { ok: true };
		},
	};
	const queue = outboundQueue({
		store,
		sessions,
		agents: new Map([["bot", agent]]),
		config: { notifications: { outbound: { mode: "immediate", target: { to: "conv:console:main", via: "console" } } } },
		participationHooks,
		delivery: () => delivery,
	} as unknown as Parameters<typeof outboundQueue>[0]);
	await store.events.record({ type: "source", data: {} });
	await queue.enqueue({ agent: "bot", session: "1", profile: "main" }, "tasks", "需要决定", {
		kind: "decision",
		key: "task:console",
		sourceEvents: ["1"],
	});
	await queue.flush();
	expect(sent).toEqual([{ to: "conv:console:main", text: "需要决定" }]);
	expect(events.find((event) => event.type === "notification.final")?.data).toMatchObject({ status: "attempted" });
});

test("an unavailable participation plugin rejects the source-based proactive notification", async () => {
	const events: Array<{
		id: string;
		type: string;
		ts: string;
		data: unknown;
		from?: string;
		conv?: string;
		routes?: unknown;
	}> = [];
	const agent = {
		id: "bot",
		social: { enabled: true, authorized: { conversations: ["conv:chat:group"] } },
		owner: "person:owner",
		bindings: [
			{ id: "group", match: { channel: "chat", kind: "group" }, session: { mode: "persistent", per: "conv" } },
		],
		profiles: {},
	};
	const store = {
		events: {
			query: async ({ type }: { type: string }) => ({ events: events.filter((event) => event.type === type) }),
			get: async (id: string) => events.find((event) => event.id === id),
			record: async (input: Record<string, unknown> & { type: string; data: unknown }) => {
				const event = { ...input, id: String(events.length + 1), ts: new Date(0).toISOString() };
				events.push(event);
				return event;
			},
		},
		sessions: {
			get: async (id: string) => ({ id, agent: "bot", profile: "main" }),
			list: async () => [{ id: "9", mode: "main" }],
		},
		identity: () => ({ account: async () => undefined }),
	};
	const sessions = {
		resolveSession: async () => ({ resolved: { capabilities: ["message"] } }),
		notifyFrom: async () => {},
	};
	const delivery = { sendOwned: async () => ({ ok: true }) };
	const config = { notifications: { outbound: { mode: "immediate" } } };
	await store.events.record({ type: "source", data: {} });
	await store.events.record({
		type: "message.in",
		from: "acct:chat:user",
		conv: "conv:chat:group",
		data: { kind: "group", msgId: "one", text: "hello", social: { mentions: { owner: true } } },
		routes: [{ agent: "bot", binding: "group", session: "1", wake: "write" }],
	});
	for (const [label, hooks, expected] of [
		["available", participationHooks, ["attempted"]],
		["unavailable", new Map(), ["attempted", "discarded"]],
	] as const) {
		// 每次都用一条新的来源入站事件，避免去重键相同。
		const source = await store.events.record({
			type: "message.in",
			from: "acct:chat:user",
			conv: "conv:chat:group",
			data: { kind: "group", msgId: label, text: "hello", social: { mentions: { owner: true } } },
			routes: [{ agent: "bot", binding: "group", session: "1", wake: "write" }],
		});
		const queue = outboundQueue({
			store,
			sessions,
			agents: new Map([["bot", agent]]),
			config,
			delivery: () => delivery,
			participationHooks: hooks,
		} as unknown as Parameters<typeof outboundQueue>[0]);
		await queue.enqueue({ agent: "bot", session: "1", profile: "main" }, "yonder", "群消息提及了主人", {
			kind: "decision",
			key: `owner-mention:${source.id}`,
			sourceEvents: [source.id],
		});
		await queue.flush();
		const finals = (await store.events.query({ type: "notification.final" })).events.map(
			(event) => (event.data as { status: string }).status,
		);
		expect(finals, label).toEqual(expected);
	}
});
