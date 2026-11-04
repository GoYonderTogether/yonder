import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { conversationMembers } from "@yonder/bot-core/tools/conversation";
import { openKernel } from "@yonder/local-host/kernel/index";
import { createStore } from "@yonder/local-host/store/index";
import { openDatabase } from "@yonder/runtime-adapter/node/runtime/db";
import { tempHome } from "@yonder/sdk/testing";
import { expect, test } from "vitest";
import { parseAgentConfig } from "../../../packages/local-host/src/config/index.js";
import { groupFixture, mainConv } from "./group-fixture.js";

const message = (text: string, mentioned = false, from = "acct:qq-main:owner") => ({
	type: "message.in",
	from,
	conv: mainConv,
	data: { kind: "group", text, msgId: randomUUID(), mentioned, social: { mentions: { bot: mentioned } } },
});

test("a restart does not re-run a direct opportunity whose batch already completed", async () => {
	const f = await groupFixture({ social: true, officialGroup: true });
	let restarted: Awaited<ReturnType<typeof openKernel>> | undefined;
	try {
		await f.probe.ios["qq-main"].emit(message("在吗", true));
		await expect.poll(() => f.probe.contexts.length, { timeout: 8000 }).toBe(1);
		const ctx = f.probe.contexts[0]!;
		await f.probe.api.messages.send({
			owner: { session: ctx.session, agent: "main", profile: "group" },
			to: mainConv,
			text: "第一次回答",
		});
		await expect
			.poll(async () => (await f.kernel.events.query({ type: "message.out" })).events.length, { timeout: 8000 })
			.toBe(1);
		f.probe.releases.get(ctx.session)?.();
		await expect
			.poll(async () => (await f.kernel.events.query({ type: "run.end" })).events.length, { timeout: 8000 })
			.toBeGreaterThan(0);
		const before = (await f.kernel.events.query({ type: "social.batch-ready" })).events.length;
		expect(before).toBe(1);
		const outsBefore = (await f.kernel.events.query({ type: "message.out" })).events.length;
		await f.kernel.close();
		restarted = await openKernel(f.home);
		// 重启只恢复未完成输入；已完成的批次不会重复调用模型、也不会重复发送。
		await new Promise((resolve) => setTimeout(resolve, 2000));
		expect((await restarted.events.query({ type: "social.batch-ready" })).events).toHaveLength(before);
		expect((await restarted.events.query({ type: "message.out" })).events).toHaveLength(outsBefore);
	} finally {
		await restarted?.close();
		await f.close();
	}
}, 40000);

test("conversation members stay bounded and deterministic for a long group history", async () => {
	const db = await openDatabase(":memory:");
	try {
		const store = await createStore(db);
		for (let index = 0; index < 260; index++)
			await store.events.record({
				type: "message.in",
				from: `acct:qq:person-${index}`,
				conv: "conv:qq:group:long",
				data: { kind: "group", text: `message ${index}` },
			});
		const members = await conversationMembers(store, "conv:qq:group:long", "main");
		expect(members.members.length).toBe(200);
		// 260 位发言人 + 本 Bot 自身 = 261，超出部分显式计数，不静默截断。
		expect(members.membersOmitted).toBe(61);
		// 结果有界且对同一账本确定（同输入重复调用一致），不会随时间无界增长。
		expect(new Set(members.members.map((member) => member.ref)).size).toBe(200);
		// 本 Bot 自己从未在这段历史里发言过，也不能因为上限被截掉。
		expect(members.members.some((member) => member.ref === "agent:main")).toBe(true);
		expect((await conversationMembers(store, "conv:qq:group:long", "main")).members).toEqual(members.members);
		// 群批次不再重复一份 recentSent。
		const batch = await conversationMembers(store, "conv:qq:group:long", "main", undefined, { recentSent: false });
		expect(batch).not.toHaveProperty("recentSent");
		expect(batch).not.toHaveProperty("recentSentScope");
	} finally {
		await db.close();
	}
});

test("the social history used by a batch stays bounded", async () => {
	const f = await groupFixture({ social: true, officialGroup: true });
	try {
		for (let index = 0; index < 40; index++) await f.probe.ios["qq-main"].emit(message(`普通消息 ${index}`));
		await f.probe.ios["qq-main"].emit(message("在吗", true));
		await expect.poll(() => f.probe.contexts.length, { timeout: 10000 }).toBe(1);
		const batches = (await f.kernel.events.query({ type: "social.batch-ready", conv: mainConv })).events;
		const history = (batches.at(-1)!.data as { publicHistory?: unknown[] }).publicHistory ?? [];
		expect(history.length).toBeLessThanOrEqual(30);
	} finally {
		await f.close();
	}
}, 40000);

test("agent config parsing is untouched by the context convergence", async () => {
	const home = await tempHome("yonder-context-");
	try {
		const file = join(home, "agent.yaml");
		await writeFile(
			file,
			`schema: 1
id: main
name: Main
owner: person:owner
defaultProfile: owner
profiles: { owner: {} }
bindings: []
`,
		);
		const agent = parseAgentConfig(await readFile(file, "utf8"), file, "main");
		expect(agent.social).toBeUndefined();
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});
