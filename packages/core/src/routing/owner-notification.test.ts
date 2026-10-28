import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { parseAgentConfig, resolveProfile, type YonderConfig } from "../config/index.js";
import { outboundQueue } from "../delivery/outbound.js";
import { openDatabase } from "../runtime/db.js";
import { Runtime } from "../runtime/index.js";
import { createSessions } from "../sessions/index.js";
import { createStore } from "../store/index.js";
import { createRouter } from "./index.js";

test("authorized owner mentions reach owner main once and revoked sources are discarded", async () => {
	const home = await mkdtemp(join(tmpdir(), "yonder-owner-notify-"));
	let runtime: Runtime | undefined;
	try {
		const db = await openDatabase(join(home, "state.db"));
		const store = await createStore(db);
		runtime = await Runtime.open({
			home,
			db,
			config: { schema: 1 },
			resolveSession: async () => ({ agent: null, profile: "default", cwd: home, resolved: resolveProfile({}) }),
		});
		const current = runtime;
		const agent = parseAgentConfig(
			`schema: 1
id: main
name: Main
owner: person:owner
defaultProfile: guest
profiles:
  guest: { capabilities: [message] }
social:
  enabled: true
  authorized: { conversations: ['conv:chat:group', 'conv:chat:muted'] }
  defaults: { group: { mode: mention } }
bindings:
  - id: group
    match: { channel: chat, kind: group }
    session: { mode: persistent, per: conv }
    profile: guest
`,
			"agent.yaml",
			"main",
		);
		const agents = new Map([[agent.id, agent]]);
		const sessions = createSessions({
			store,
			home,
			config: {
				schema: 1,
				defaultModel: "openai/gpt-6-luna",
				agents: [{ id: "main", workspace: "./agents/main" }],
			} as YonderConfig,
			version: "test",
			agents,
			pluginPresets: new Map(),
			homePresets: new Map(),
			runtime: () => current,
		});
		const main = (await sessions.ensureAgent("main", "guest", "main", "main")).session;
		const queue = outboundQueue({
			store,
			sessions,
			agents,
			config: { notifications: { outbound: { mode: "immediate" } } } as YonderConfig,
			delivery: () => {
				throw new Error("unexpected external delivery");
			},
		});
		const router = createRouter({
			store,
			sessions,
			runtime: () => current,
			agents,
			notifications: { default: "mention", conversations: { "conv:chat:muted": "mute" } },
			onOwnerMention: async (session, event) => {
				await queue.enqueue(
					{ session: session.id, agent: session.agent, profile: session.profile },
					"yonder",
					`群消息提及了主人：${event.conv}`,
					{ kind: "decision", key: `owner-mention:${event.id}`, sourceEvents: [event.id] },
				);
			},
		});
		const input = (conv: string, msgId: string, owner: boolean) => ({
			type: "message.in",
			from: "acct:chat:user",
			conv,
			data: { kind: "group", msgId, text: "hello", social: { mentions: { owner } } },
		});
		const accepted = await router.emit(input("conv:chat:group", "one", true));
		const session = accepted.routes?.[0]?.session;
		expect(accepted.routes?.[0]?.wake).toBe("write");
		if (!session) throw new Error("missing group session");
		const notifications = async (id: string) =>
			(await current.transcript(id)).filter((entry) => entry.kind === "yonder.notification");
		await expect.poll(async () => (await store.events.query({ type: "notification.intent" })).events.length).toBe(1);
		expect((await sessions.resolveSession(session)).resolved.capabilities).toContain("message");
		await queue.flush();
		expect((await store.events.query({ type: "notification.final" })).events.map((event) => event.data)).toMatchObject([
			{ status: "attempted" },
		]);
		expect(await notifications(main.id)).toMatchObject([{ text: "群消息提及了主人：conv:chat:group" }]);
		await router.emit(input("conv:chat:group", "one", true));
		await queue.flush();
		expect(await notifications(main.id)).toHaveLength(1);
		const ordinary = await router.emit(input("conv:chat:group", "two", false));
		expect(ordinary.routes?.[0]?.dropped).toBe("no-binding");
		const denied = await router.emit(input("conv:chat:other", "three", true));
		expect(denied.routes?.[0]?.dropped).toBe("no-binding");
		const muted = await router.emit(input("conv:chat:muted", "four", true));
		const mutedSession = muted.routes?.[0]?.session;
		if (!mutedSession) throw new Error("missing muted session");
		await expect.poll(() => current.transcript(mutedSession).then((rows) => rows.length)).toBeGreaterThan(0);
		expect(await notifications(mutedSession)).toHaveLength(0);
		await expect.poll(async () => (await store.events.query({ type: "notification.intent" })).events.length).toBe(2);
		agent.social!.authorized!.conversations = [];
		await queue.flush();
		expect(await notifications(main.id)).toHaveLength(1);
		expect(
			(await store.events.query({ type: "notification.final" })).events.map(
				(event) => (event.data as { status: string }).status,
			),
		).toEqual(["attempted", "discarded"]);
		expect((await store.events.query({ type: "run.start" })).events).toHaveLength(0);
	} finally {
		await runtime?.close();
		await rm(home, { recursive: true, force: true });
	}
});
