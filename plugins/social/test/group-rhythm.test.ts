import { randomUUID } from "node:crypto";
import type { ExecutionOwner, ToolContext } from "@yonder/sdk";
import { expect, test, vi } from "vitest";
import { QUIET_MAX_MS } from "../src/group-rhythm.js";
import { gptConv, groupFixture, mainConv } from "./group-fixture.js";

const owner = (ctx: ToolContext): ExecutionOwner => ({ session: ctx.session, agent: ctx.agent, profile: ctx.profile });
const message = (instance: string, conv: string, text: string, mentioned = false) => ({
	type: "message.in",
	from: `acct:${instance}:owner`,
	conv,
	data: {
		kind: "group",
		text,
		msgId: randomUUID(),
		mentioned,
		social: { mentions: { bot: mentioned } },
	},
});

test("consecutive direct mentions merge into one short window instead of one run per message", async () => {
	const f = await groupFixture({ social: true, officialGroup: true });
	try {
		const started = Date.now();
		const first = await f.probe.ios["qq-main"].emit(message("qq-main", mainConv, "第一个问题", true));
		const second = await f.probe.ios["qq-main"].emit(message("qq-main", mainConv, "紧接着的补充", true));
		await expect.poll(() => f.probe.contexts.length, { timeout: 6000 }).toBe(1);
		const elapsed = Date.now() - started;
		// 短合并约 1–1.5 秒，不是旧观察窗，也不是逐条运行。
		expect(elapsed).toBeGreaterThanOrEqual(900);
		expect(elapsed).toBeLessThan(5000);
		// 同一段连续追问只产生一次运行。
		await new Promise((resolve) => setTimeout(resolve, 200));
		expect(f.probe.contexts).toHaveLength(1);
		// 这次运行带着两条真实来源，而不是只有第一条或一段无来源的提醒。
		const batches = (await f.kernel.events.query({ type: "social.batch-ready", conv: mainConv })).events;
		expect(batches).toHaveLength(1);
		expect((batches[0]!.data as { sourceEvents: string[] }).sourceEvents).toEqual([first.id, second.id]);
		expect((batches[0]!.data as { through: string }).through).toBe(second.id);
	} finally {
		await f.close();
	}
}, 30000);

test("quiet time is deterministic per room and never depends on a random draw", async () => {
	const { quietFor, quietDue, MAX_WAIT_MS, QUIET_MIN_MS, QUIET_MAX_MS } = await import("../src/group-rhythm.js");
	const quiet = quietFor(mainConv);
	vi.spyOn(Math, "random").mockReturnValue(0.99);
	const same = quietFor(mainConv);
	vi.restoreAllMocks();
	expect(same).toBe(quiet);
	expect(quiet).toBeGreaterThanOrEqual(QUIET_MIN_MS);
	expect(quiet).toBeLessThanOrEqual(QUIET_MAX_MS);
	// 同一批的不同候选得到同一个静默值；首条起 120 秒硬顶不因后续消息推迟。
	expect(quietFor(gptConv)).toBe(quietFor(gptConv));
	const first = "2026-10-31T00:00:00.000Z";
	const now = Date.parse(first) + 1000;
	expect(quietDue(now, quiet, [first], now)).toBe(now + quiet);
	// 后续消息不断刷新 lastHumanAt 也不能超过首条起的 120 秒硬顶。
	const late = Date.parse(first) + MAX_WAIT_MS + 1;
	expect(quietDue(late, 15000, [first], late)).toBe(Date.parse(first) + MAX_WAIT_MS);
});

test("a derived default range records ordinary messages without ever running the count fallback", async () => {
	// 没有 social 配置、只有官方群 write 绑定：08 的派生默认范围只做硬触发，count 兜底不得自行唤醒。
	const f = await groupFixture({ officialGroup: true });
	try {
		for (let index = 0; index < 25; index++)
			await f.probe.ios["qq-main"].emit(message("qq-main", mainConv, `普通消息 ${index}`));
		// 静默窗最长 15 秒；旧实现会在这之后按 count=20 兜底自行发起一次批次运行。
		await new Promise((resolve) => setTimeout(resolve, QUIET_MAX_MS + 4000));
		expect((await f.kernel.events.query({ type: "social.batch-ready", conv: mainConv })).events).toHaveLength(0);
		expect(f.probe.contexts).toHaveLength(0);
		const decisions = (await f.kernel.events.query({ type: "routing.social-decision" })).events;
		expect(decisions.length).toBeGreaterThan(0);
		expect(decisions.every((event) => (event.data as { derivedDefault?: boolean }).derivedDefault === true)).toBe(true);
	} finally {
		await f.close();
	}
}, 40000);

test("a busy resident receives the real new messages and their sources through the native steer path", async () => {
	const f = await groupFixture({ social: true, officialGroup: true });
	const { kernel, probe } = f;
	try {
		const first = await probe.ios["qq-main"].emit(message("qq-main", mainConv, "在吗", true));
		await expect.poll(() => probe.contexts.some((ctx) => ctx.agent === "main"), { timeout: 5000 }).toBe(true);
		const resident = probe.contexts.find((ctx) => ctx.agent === "main");
		if (!resident) throw new Error("Resident run missing");
		// 运行中来了相关补充：真实事件沿原生 steer 并入，不是无来源的“请复核”。
		const followUp = await probe.ios["qq-main"].emit(message("qq-main", mainConv, "贾维斯，再补充一点", true));
		await expect
			.poll(
				async () =>
					(await kernel.events.query({ type: "social.batch-ready", conv: mainConv })).events.some(
						(event) =>
							(event.data as { sourceEvents?: string[] }).sourceEvents?.includes(followUp.id) &&
							(event.data as { agent?: string }).agent === "main",
					),
				{ timeout: 8000 },
			)
			.toBe(true);
		const steered = (await kernel.events.query({ type: "social.batch-ready", conv: mainConv })).events.find((event) =>
			(event.data as { sourceEvents?: string[] }).sourceEvents?.includes(followUp.id),
		);
		expect(steered?.data).toMatchObject({ through: followUp.id, sourceEvents: expect.arrayContaining([followUp.id]) });
		// 原生 steer 在生成中取消旧生成并并入（steeringMode: all）；普通新消息不会取消整个会话，
		// 也不会让已发生的工具副作用回滚。
		expect(resident.session).toBeDefined();
		expect(first.id).not.toBe(followUp.id);
		// 只有一条机会被授予，插话没有另开第二条运行。
		const grants = (await kernel.events.query({ type: "social.group-turn" })).events.filter(
			(event) => (event.data as { action?: string }).action === "grant",
		);
		expect(grants).toHaveLength(1);
	} finally {
		await f.close();
	}
}, 30000);

test("a stop still aborts the run and the invalidated turn refuses the unsent draft", async () => {
	const f = await groupFixture({ social: true, officialGroup: true });
	const { kernel, probe } = f;
	try {
		await probe.ios["qq-main"].emit(message("qq-main", mainConv, "在吗", true));
		await expect.poll(() => probe.contexts.some((ctx) => ctx.agent === "main"), { timeout: 5000 }).toBe(true);
		const resident = probe.contexts.find((ctx) => ctx.agent === "main");
		if (!resident) throw new Error("Resident run missing");
		await probe.ios["qq-main"].emit(message("qq-main", mainConv, "闭嘴", true));
		await expect.poll(() => resident.signal.aborted, { timeout: 5000 }).toBe(true);
		// 已停止的运行不能再借旧机会发送。
		await expect(
			probe.api.messages.send({ owner: owner(resident), to: mainConv, text: "已停止的草稿" }),
		).rejects.toThrow("暂停");
		const turns = (await kernel.events.query({ type: "social.group-turn" })).events;
		expect(turns.some((event) => (event.data as { action?: string }).action === "release")).toBe(true);
		expect(probe.sent).toEqual([]);
	} finally {
		await f.close();
	}
}, 30000);

test("an explicit mention keeps its own opportunity even after another Bot answered", async () => {
	const f = await groupFixture({ social: true, officialGroup: true });
	const { kernel, probe } = f;
	try {
		// 两位被同时点名：明确点名各保留机会，第一位回答不取消第二位。
		await probe.ios["qq-main"].emit(message("qq-main", mainConv, "在吗", true));
		await expect.poll(() => probe.contexts.some((ctx) => ctx.agent === "main"), { timeout: 6000 }).toBe(true);
		const first = probe.contexts.find((ctx) => ctx.agent === "main");
		if (!first) throw new Error("First resident missing");
		await probe.ios["qq-gpt"].emit(message("qq-gpt", gptConv, "在吗", true));
		probe.onRequest = async (ctx) => {
			if (ctx.agent !== "main") return;
			await probe.api.messages.send({ owner: owner(ctx), to: mainConv, text: "第一位已经回答" });
		};
		probe.releases.get(first.session)?.();
		await expect.poll(() => probe.sent.length, { timeout: 8000 }).toBe(1);
		await expect.poll(() => probe.contexts.some((ctx) => ctx.agent === "gpt-senpai"), { timeout: 8000 }).toBe(true);
		const second = probe.contexts.find((ctx) => ctx.agent === "gpt-senpai");
		if (!second) throw new Error("Second resident missing");
		expect(
			await probe.api.messages.send({ owner: owner(second), to: gptConv, text: "第二位回应给自己的点名" }),
		).toMatchObject({ ok: true });
		expect(probe.sent).toHaveLength(2);
		const releases = (await kernel.events.query({ type: "social.group-turn" })).events.filter(
			(event) => (event.data as { action?: string }).action === "release",
		);
		expect(releases.every((event) => (event.data as { reason?: string }).reason !== "answered")).toBe(true);
	} finally {
		await f.close();
	}
}, 40000);
