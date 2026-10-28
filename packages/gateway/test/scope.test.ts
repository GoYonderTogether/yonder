import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { initHome, openKernel, releaseInfo, setAccessTokenHash } from "@yonder/core";
import type { EventPage } from "@yonder/sdk";
import { afterAll, describe, expect, it } from "vitest";
import { parse, stringify } from "yaml";
import { testModel } from "../../core/src/config/test-support.js";
import { filterTaskOnly } from "../../core/src/control/guard.js";
import { principalOf, tokenHash } from "../src/auth.js";
import { startGateway } from "../src/index.js";

const ACCESS = "remote-access-token-for-scope-test";
const cleanup: Array<() => Promise<void>> = [];
afterAll(async () => {
	for (const close of cleanup.reverse()) await close();
});

async function start(remoteOwner: boolean) {
	const home = await mkdtemp("/tmp/yonder-gateway-scope-");
	cleanup.push(() => rm(home, { recursive: true, force: true }));
	await initHome(home, "owner", { model: testModel });
	await setAccessTokenHash(home, tokenHash(ACCESS));
	const config = parse(await readFile(join(home, "yonder.yaml"), "utf8"));
	config.gateway = { ...config.gateway, remoteOwner };
	await writeFile(join(home, "yonder.yaml"), stringify(config));
	// A real console binding writes into main without starting model inference.
	const agentFile = join(home, "agents/main/agent.yaml");
	const agent = parse(await readFile(agentFile, "utf8"));
	agent.bindings.unshift({
		id: "scope-console",
		match: { channel: "console", kind: "dm", from: "owner" },
		session: "main",
		profile: "owner",
		wake: "write",
	});
	await writeFile(agentFile, stringify(agent));
	const kernel = await openKernel(home);
	cleanup.push(() => kernel.close());
	const bot = await kernel.bots.send("main", "scope admission check");
	const task = await kernel.sessions.open({ preset: "default", close: "manual" });
	const taskEvent = (await kernel.events.query({ type: "session.open" })).events.find(
		(event) => "session" in event.data && event.data.session === task.id,
	);
	if (!taskEvent) throw new Error("Missing task session.open event");
	const gateway = await startGateway({
		home,
		host: { kernel, home, releaseInfo: () => releaseInfo(home), awakeStatus: () => ({}), stop: () => {} },
	});
	cleanup.push(() => gateway.close());
	const base = `http://127.0.0.1:${gateway.port}`;
	const state = JSON.parse(await readFile(join(home, ".yonder/gateway.json"), "utf8")) as { token: string };
	const ticket = await fetch(`${base}/?token=${state.token}`, { redirect: "manual" });
	const local = (ticket.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
	const login = await fetch(`${base}/login`, {
		method: "POST",
		headers: { "content-type": "application/json", origin: base },
		body: JSON.stringify({ token: ACCESS }),
	});
	const remote = (login.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
	const call = async (cookie: string, method: string, params: unknown) => {
		const res = await fetch(`${base}/api/rpc/${method}`, {
			method: "POST",
			headers: { "content-type": "application/json", origin: base, cookie },
			body: JSON.stringify(params),
		});
		return {
			status: res.status,
			body: (await res.json()) as {
				ok: boolean;
				result?: EventPage;
				error?: { code: string };
			},
		};
	};
	return { bot, task, taskEvent, local, remote, call };
}

const requests = (id: string, event: string) =>
	[
		["events.query", { query: { id: event } }],
		["sessions.notify", { id, event, text: "scope notification check" }],
		["sessions.command", { id, command: "status" }],
		["terminal.info", { id }],
	] as const;

describe("session scope isolation", () => {
	it("remote read/write is forbidden on Bot methods; local and task access succeed", async () => {
		const { bot, task, taskEvent, local, remote, call } = await start(false);
		await expect
			.poll(async () => {
				const page = await call(local, "sessions.transcript", { id: bot.session, limit: 50 });
				const transcript = page.body.result as unknown as { items: { event?: string }[] };
				return transcript.items.some((item) => item.event === bot.event);
			})
			.toBe(true);
		expect(await call(remote, "sessions.transcript", { id: bot.session, limit: 50 })).toMatchObject({ status: 403 });
		const source = await call(local, "events.query", { query: { id: bot.event } });
		expect(source.body.result?.events[0]).toMatchObject({
			id: bot.event,
			type: "message.in",
			data: { text: "scope admission check" },
			routes: expect.arrayContaining([expect.objectContaining({ session: bot.session })]),
		});
		for (const [method, params] of requests(bot.session, bot.event)) {
			const denied = await call(remote, method, params);
			expect(denied, method).toMatchObject({ status: 403, body: { ok: false, error: { code: "forbidden" } } });
			expect(await call(local, method, params), method).toMatchObject({ status: 200, body: { ok: true } });
		}
		for (const [method, params] of requests(task.id, taskEvent.id)) {
			expect(await call(remote, method, params), method).toMatchObject({ status: 200, body: { ok: true } });
		}
		const page = await call(remote, "events.query", {});
		expect(page.body.result?.events.map((event) => event.id)).toContain(taskEvent.id);
		expect(page.body.result?.events.map((event) => event.id)).not.toContain(bot.event);
		// session.open has data.session and no routes; global events have neither.
		for (const event of page.body.result?.events ?? []) {
			expect("session" in event.data && event.data.session).toBe(task.id);
		}
		const botOpen = await call(local, "events.query", { query: { type: "session.open" } });
		const opened = botOpen.body.result?.events.find(
			(event) => "session" in event.data && event.data.session === bot.session,
		);
		expect(opened).toBeDefined();
		expect(await call(remote, "events.query", { query: { id: opened?.id } })).toMatchObject({ status: 403 });
	}, 60_000);

	it("remoteOwner allows all four Bot methods and unfiltered event queries", async () => {
		const { bot, remote, call } = await start(true);
		for (const [method, params] of requests(bot.session, bot.event)) {
			expect(await call(remote, method, params), method).toMatchObject({ status: 200, body: { ok: true } });
		}
		const page = await call(remote, "events.query", {});
		expect(page.body.result?.events.map((event) => event.id)).toContain(bot.event);
	}, 60_000);

	it("filterTaskOnly preserves rows for owner and only task rows without owner", () => {
		const items = ["main", "persistent", "ephemeral", "task"].map((mode) => ({ mode }));
		expect(filterTaskOnly(principalOf("remote", false), items)).toEqual([{ mode: "task" }]);
		expect(filterTaskOnly(principalOf("local", false), items)).toBe(items);
		expect(filterTaskOnly(principalOf("remote", true), items)).toBe(items);
	});
});
