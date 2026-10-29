// Contract tests: real `yonder init` scaffolding and a real identity store; the card backend is a loopback
// protocol double, never a model double. Covers SOC01 G-01 (default card bindings) and G-02 (device
// authorization links only the device owner's own account, so its DM is judged owner and enters main).

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginAPI, Ref, YEvent } from "@yonder/sdk";
import { afterEach, expect, test, vi } from "vitest";
import { WebSocketServer } from "ws";
import { parseAgentConfig, parseYonderConfig } from "../../../packages/core/src/config/index.js";
import { initHome } from "../../../packages/core/src/kernel/home.js";
import { matches, sessionKey } from "../../../packages/core/src/routing/matching.js";
import { openDatabase } from "../../../packages/core/src/runtime/db.js";
import { createStore } from "../../../packages/core/src/store/index.js";
import { CardChannel } from "../src/channel.js";

const MODEL = "workbuddy/deepseek-v4.1-flash";
const OWNER_ACCOUNT = "3f2b6c1e-7d4a-4b8f-9c21-2a5d7e9f1b34";
const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
	for (const close of cleanups.splice(0).reverse()) await close();
});

async function scaffold() {
	const home = await mkdtemp(join(tmpdir(), "yonder-card-init-"));
	cleanups.push(() => rm(home, { recursive: true, force: true }));
	await initHome(home, "owner", { model: MODEL });
	const agent = parseAgentConfig(await readFile(join(home, "agents/main/agent.yaml"), "utf8"), "agent.yaml", "main");
	return { home, agent };
}

test("SOC01 G-01: init scaffolds the card owner and group bindings", async () => {
	const { home, agent } = await scaffold();
	const yonder = parseYonderConfig(await readFile(join(home, "yonder.yaml"), "utf8"), "yonder.yaml");
	expect(yonder.channels?.card).toEqual({ type: "card" });
	expect(agent.bindings.find((binding) => binding.id === "card-owner")).toMatchObject({
		match: { channel: "card", kind: "dm", from: "owner" },
		session: "main",
		profile: "owner",
	});
	expect(agent.bindings.find((binding) => binding.id === "card-group")).toMatchObject({
		match: { channel: "card", kind: "group" },
		session: { mode: "persistent", per: "conv" },
		profile: "readonly",
		wake: "mention",
	});
	// 群绑定引用的只读档案必须真的存在，否则路由取不到 profile。
	expect(agent.profiles.readonly).toMatchObject({ level: "readonly" });
});

/** 设备授权后的会话：/api/session 给出设备主人自己的账号，其余端点只走设备令牌。 */
async function backend() {
	const server = createServer(async (req, res) => {
		let text = "";
		for await (const chunk of req) text += chunk;
		const body = text ? (JSON.parse(text) as Array<{ key: string }>) : undefined;
		res.setHeader("content-type", "application/json");
		if (req.method === "PUT" && req.url === "/api/device/agents")
			res.end(JSON.stringify(body!.map((agent) => ({ key: agent.key, id: `platform-${agent.key}` }))));
		else if (req.method === "GET" && req.url === "/api/session")
			res.end(JSON.stringify({ actor: { id: OWNER_ACCOUNT } }));
		else if (req.url === "/api/device/start")
			res.end(JSON.stringify({ code: "contract-code", url: `${base}/connect?code=contract-code` }));
		else if (req.url?.startsWith("/api/device/poll"))
			res.end(JSON.stringify({ status: "confirmed", deviceToken: "contract-token" }));
		else {
			res.statusCode = 404;
			res.end("{}");
		}
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
	const wss = new WebSocketServer({ server, path: "/ws/device" });
	wss.on("connection", (socket) => socket.on("message", () => {}));
	cleanups.push(async () => {
		for (const socket of wss.clients) socket.terminate();
		await new Promise<void>((resolve) => wss.close(() => resolve()));
		await new Promise<void>((resolve) => server.close(() => resolve()));
	});
	return base;
}

test("SOC01 G-02: device authorization links the owner's own account so its DM enters main", async () => {
	const { agent } = await scaffold();
	const data = await mkdtemp(join(tmpdir(), "yonder-card-state-"));
	cleanups.push(() => rm(data, { recursive: true, force: true }));
	const db = await openDatabase(join(data, "state.db"));
	cleanups.push(() => db.close());
	const store = await createStore(db);
	await store.identity().createPerson({ id: "owner", name: "主人" });
	const endpoint = await backend();
	const api = {
		paths: { data },
		agents: { list: async () => [{ id: "main", name: "Main", owner: "person:owner" as Ref }] },
		identity: store.identity(),
		log: { warn: vi.fn() },
	} as unknown as PluginAPI;
	const channel = new CardChannel("card-local", { endpoint }, api);
	cleanups.push(() => channel.stop());
	await channel.start({
		emit: async (event) => ({ ...event, id: "event", ts: new Date().toISOString() }) as YEvent,
		ask: async () => {
			throw new Error("no ask");
		},
	});
	const signal = new AbortController().signal;
	await channel.login("start", signal);
	await channel.login("poll", signal);
	// 设备主人自己的账号被关联到 agent owner；DM 因此判为 owner 进入主对话。
	const account = `acct:card-local:main:${OWNER_ACCOUNT}` as Ref;
	await vi.waitFor(async () =>
		expect(await store.identity().account(account)).toMatchObject({ person: "person:owner" }),
	);
	const binding = agent.bindings.find((item) => item.id === "card-owner")!;
	const dm = {
		id: "event-1",
		ts: new Date().toISOString(),
		type: "message.in",
		from: account,
		conv: "conv:card:room-1" as Ref,
		data: { kind: "dm", text: "在吗" },
	} as unknown as YEvent;
	expect(await matches(binding, dm, agent, store)).toBe(true);
	expect(sessionKey(binding, dm)).toEqual({ mode: "main", key: "main" });
	// 同一会话里别人的账号不会因为设备授权变成 owner。
	const stranger = { ...dm, from: "acct:card-local:main:visitor" as Ref };
	expect(await matches(binding, stranger, agent, store)).toBe(false);
	// 群绑定只按会话各开持久会话，唤醒条件是 @。
	const group = agent.bindings.find((item) => item.id === "card-group")!;
	expect(sessionKey(group, { ...dm, conv: "conv:card:group-1" as Ref })).toEqual({
		mode: "persistent",
		key: "conv:conv:card:group-1",
	});
	expect(group.wake).toBe("mention");
});
