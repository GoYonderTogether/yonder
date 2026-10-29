import { expect, test } from "vitest";
import type { YonderConfig } from "../config/index.js";
import { parseAgentConfig } from "../config/index.js";
import { openDatabase } from "../runtime/db.js";
import type { Runtime } from "../runtime/index.js";
import { createSessions } from "../sessions/index.js";
import { createStore } from "../store/index.js";
import { socialDisplayView } from "../views/social-group.js";
import { GroupDisplay, groupSessionTarget, mainDisplayKind, mainDisplayTypes } from "./group-session.js";
import { createRouter } from "./index.js";

const agent = () =>
	parseAgentConfig(
		`schema: 1
id: main
name: Main
owner: person:owner
defaultProfile: guest
profiles:
  guest: {}
bindings:
  - id: group
    match: { kind: group }
    session: { mode: persistent, per: conv }
    wake: write
  - id: speech
    match: { type: ${mainDisplayTypes["bot-speech"]} }
    session: main
    wake: write
  - id: attention
    match: { type: ${mainDisplayTypes.attention} }
    session: main
    wake: write
`,
		"agent.yaml",
		"main",
	);

async function harness() {
	const db = await openDatabase(":memory:");
	const store = await createStore(db);
	const config = agent();
	let next = 100;
	const submitted: string[] = [];
	const runtime = {
		create: async () => String(next++),
		submit: async (id: string) => {
			submitted.push(id);
			return {
				runId: "run",
				status: "done" as const,
				text: "",
				usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
				inputs: [],
			};
		},
	} as unknown as Runtime;
	const sessions = createSessions({
		store,
		agents: new Map([[config.id, config]]),
		homePresets: new Map(),
		pluginPresets: new Map(),
		home: "/tmp/yonder",
		config: { agents: [{ id: "main", workspace: "./agents/main" }] } as YonderConfig,
		version: "0.1.0",
		runtime: () => runtime,
	});
	const router = createRouter({ store, sessions, runtime: () => runtime, agents: new Map([[config.id, config]]) });
	return { db, store, router, submitted };
}

test("群消息只进群会话，main 只收到 Bot 发言与需关注摘要", async () => {
	const { db, store, router, submitted } = await harness();
	try {
		const display = new GroupDisplay({ now: () => "2026-10-29T00:00:00.000Z" });
		const main = await store.sessions.get("100");
		expect(main).toBeUndefined();
		const conv = "conv:qq:group:dev";
		const routed: string[] = [];
		for (let index = 0; index < 100; index++) {
			const event = await router.emit({
				type: "message.in",
				from: "acct:qq:member",
				conv,
				data: { kind: "group", text: `原文 ${index}: 今天吃什么` },
			});
			expect(mainDisplayKind(event)).toBeUndefined();
			for (const route of event.routes ?? []) {
				const session = route.session ?? "";
				routed.push(session);
				expect((await store.sessions.get(session))?.mode).toBe("persistent");
				expect((await store.sessions.get(session))?.key).toBe(`conv:${conv}`);
				expect(display.accept(event)).toBeUndefined();
			}
		}
		expect(new Set(routed).size).toBe(1);
		expect(display.refused).toBe(100);
		expect(groupSessionTarget(conv)).toEqual({ mode: "persistent", key: `conv:${conv}` });

		const speech = await router.emit({
			type: mainDisplayTypes["bot-speech"],
			from: "plugin:social",
			conv,
			data: { text: "我先看下这个报错" },
		});
		const attention = await router.emit({
			type: mainDisplayTypes.attention,
			from: "plugin:social",
			conv,
			data: { text: "群里在确认发布时间，需要你拍板" },
		});
		const mainSession = speech.routes?.[0]?.session ?? "";
		expect(mainSession).not.toBe("");
		expect((attention.routes ?? []).map((route) => route.session)).toEqual([mainSession]);
		expect(routed).not.toContain(mainSession);
		expect(await store.sessions.get(mainSession)).toMatchObject({ mode: "main", key: "main" });
		expect(display.accept(speech)?.kind).toBe("bot-speech");
		expect(display.accept(attention)?.kind).toBe("attention");
		expect(display.items().map((item) => item.text)).toEqual(["我先看下这个报错", "群里在确认发布时间，需要你拍板"]);
		expect(submitted.length).toBeGreaterThan(0);
	} finally {
		await db.close();
	}
});

test("main 的群显示视图只列 Bot 发言与需关注摘要", async () => {
	const display = new GroupDisplay({ capacity: 3, now: () => "2026-10-29T00:00:00.000Z" });
	const { decl, provider } = socialDisplayView(display);
	for (let index = 0; index < 100; index++)
		display.accept({
			id: `in-${index}`,
			type: "message.in",
			conv: "conv:qq:group:dev",
			data: { kind: "group", text: `原文 ${index}` },
		});
	display.accept({
		id: "e1",
		type: mainDisplayTypes["bot-speech"],
		conv: "conv:qq:group:dev",
		data: { text: "我在群里答了" },
	});
	display.accept({ id: "e2", type: mainDisplayTypes.attention, conv: "conv:qq:group:dev", data: { text: "等你拍板" } });
	display.accept({
		id: "e3",
		type: mainDisplayTypes["bot-speech"],
		conv: "conv:qq:group:dev",
		data: { text: "已建群文档" },
	});
	expect(display.refused).toBe(100);
	expect(() => provider.data(undefined)).toThrow("Session required");
	const data = await provider.data("main");
	expect(data.viewId).toBe("core.social.display");
	expect(decl).toMatchObject({ plugin: "core", placement: "rail", scope: "session" });
	expect(data.content).toMatchObject({
		type: "list",
		items: [
			{ id: "e1", title: "我在群里答了", subtitle: "群内发言" },
			{ id: "e2", title: "等你拍板", subtitle: "需要关注" },
			{ id: "e3", title: "已建群文档", subtitle: "群内发言" },
		],
	});
	expect(data.badge).toBe(1);
	expect(JSON.stringify(data.content)).not.toContain("原文");
	display.accept({
		id: "e4",
		type: mainDisplayTypes["bot-speech"],
		conv: "conv:qq:group:dev",
		data: { text: "第四条" },
	});
	expect(display.items().map((item) => item.id)).toEqual(["e2", "e3", "e4"]);
});
