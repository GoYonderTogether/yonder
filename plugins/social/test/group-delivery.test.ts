import { randomUUID } from "node:crypto";
import type { ExecutionOwner, ToolContext } from "@yonder/sdk";
import { expect, test } from "vitest";
import { gptConv, groupFixture, mainConv, privateConv } from "./group-fixture.js";

const owner = (ctx: ToolContext): ExecutionOwner => ({ session: ctx.session, agent: ctx.agent, profile: ctx.profile });
const input = (instance: string, conv: string, mentioned: boolean) => ({
	type: "message.in",
	from: `acct:${instance}:owner`,
	conv,
	data: {
		kind: conv === privateConv ? "dm" : "group",
		text: mentioned ? "在吗" : "logo 和界面",
		msgId: randomUUID(),
		mentioned,
		social: { mentions: { bot: mentioned } },
	},
});

test("real owned group delivery keeps an addressed resident's turn across ordinary inputs and leaves private delivery alone", async () => {
	const fixture = await groupFixture();
	const { kernel, probe } = fixture;
	try {
		await probe.ios["qq-main"].emit(input("qq-main", mainConv, true));
		await expect.poll(() => probe.contexts.some((ctx) => ctx.agent === "main"), { timeout: 5000 }).toBe(true);
		const main = probe.contexts.find((ctx) => ctx.agent === "main");
		if (!main) throw new Error("Real main request context missing");
		// A request hook's context cannot impersonate a native tool invocation.
		expect(await probe.api.messages.send({ to: mainConv, text: "不能绕过工具调用边界" }, main)).toMatchObject({
			ok: false,
			error: expect.stringContaining("真实运行中的工具调用上下文"),
		});
		await probe.ios["qq-gpt"].emit(input("qq-gpt", gptConv, false));
		await probe.ios["qq-main"].emit(input("qq-main", mainConv, false));
		expect(main.signal.aborted).toBe(false);
		probe.onRequest = async (ctx) => {
			if (ctx.session !== main.session) return;
			for (const text of ["目标 Bot 的第一条回答", "目标 Bot 的第二条回答"])
				probe.results.push(await probe.api.messages.send({ owner: owner(ctx), to: mainConv, text }));
		};
		probe.releases.get(main.session)?.();
		await expect.poll(() => probe.results.length, { timeout: 5000 }).toBe(2);
		expect(
			probe.results.every((result) => result.ok),
			JSON.stringify(probe.results),
		).toBe(true);
		expect(probe.sent).toEqual([
			{ to: mainConv, text: "目标 Bot 的第一条回答" },
			{ to: mainConv, text: "目标 Bot 的第二条回答" },
		]);
		await expect
			.poll(
				async () =>
					(await kernel.events.query({ type: "run.end" })).events.some(
						(event) => (event.data as { session?: string }).session === main.session,
					),
				{ timeout: 5000 },
			)
			.toBe(true);
		await expect(
			probe.api.messages.send({ owner: owner(main), to: mainConv, text: "运行结束后不可继续借用旧机会" }),
		).rejects.toThrow("发言机会");
		const privateSource = await probe.ios["qq-main"].emit(input("qq-main", privateConv, false));
		const privateSession = privateSource.routes?.find((route) => route.agent === "main" && !route.dropped)?.session;
		if (!privateSession) throw new Error("Real private write session missing");
		expect(
			await probe.api.messages.send({
				owner: { session: privateSession, agent: "main", profile: "private" },
				to: privateConv,
				text: "私聊不受群调度限制",
			}),
		).toMatchObject({ ok: true });
		expect(probe.sent).toHaveLength(3);
		expect((await kernel.events.query({ type: "message.out" })).events).toHaveLength(3);
	} finally {
		await fixture.close();
	}
}, 30000);

test("real addressed residents wait their room turn and a native turn can publish multiple bubbles", async () => {
	const fixture = await groupFixture();
	const { kernel, probe } = fixture;
	try {
		await probe.ios["qq-main"].emit(input("qq-main", mainConv, true));
		await expect.poll(() => probe.contexts.some((ctx) => ctx.agent === "main"), { timeout: 5000 }).toBe(true);
		await probe.ios["qq-gpt"].emit(input("qq-gpt", gptConv, true));
		const main = probe.contexts.find((ctx) => ctx.agent === "main");
		if (!main) throw new Error("Real first request context missing");
		// The second native run waits before the provider/probe hook, rather than generating a competing answer.
		await new Promise((resolve) => setTimeout(resolve, 30));
		expect(probe.contexts.some((ctx) => ctx.agent === "gpt-senpai")).toBe(false);
		expect(probe.sent).toEqual([]);
		expect(main.signal.aborted).toBe(false);
		probe.onRequest = async (ctx) => {
			const texts = ctx.agent === "main" ? ["第一位的第一条", "第一位的第二条"] : ["第二位的回答"];
			const to = ctx.agent === "main" ? mainConv : gptConv;
			for (const text of texts) probe.results.push(await probe.api.messages.send({ owner: owner(ctx), to, text }));
		};
		probe.releases.get(main.session)?.();
		await expect.poll(() => probe.contexts.some((ctx) => ctx.agent === "gpt-senpai"), { timeout: 5000 }).toBe(true);
		const gpt = probe.contexts.find((ctx) => ctx.agent === "gpt-senpai");
		if (!gpt) throw new Error("Second addressed run did not receive the released opportunity");
		expect(probe.sent).toEqual([
			{ to: mainConv, text: "第一位的第一条" },
			{ to: mainConv, text: "第一位的第二条" },
		]);
		expect(gpt.signal.aborted).toBe(false);
		probe.releases.get(gpt.session)?.();
		await expect.poll(() => probe.results.length, { timeout: 5000 }).toBe(3);
		expect(
			probe.results.every((result) => result.ok),
			JSON.stringify(probe.results),
		).toBe(true);
		expect(probe.sent).toEqual([
			{ to: mainConv, text: "第一位的第一条" },
			{ to: mainConv, text: "第一位的第二条" },
			{ to: gptConv, text: "第二位的回答" },
		]);
		expect((await kernel.events.query({ type: "message.out" })).events).toHaveLength(3);
	} finally {
		await fixture.close();
	}
}, 30000);

test("installed official social hooks leave a selected alternative participation plugin's addressed delivery alone", async () => {
	const fixture = await groupFixture({ social: true, strategy: "delivery-probe", captureSocialApi: true });
	const { kernel, probe } = fixture;
	try {
		expect(probe.socialApi?.id).toBe("social");
		const source = await probe.ios["qq-main"].emit(input("qq-main", mainConv, true));
		const inspected = await kernel.social.inspect(
			{ agent: "main", conv: mainConv },
			{ id: "test-owner", kind: "local", transport: "socket", scopes: ["owner", "admin"] },
		);
		expect(inspected.policy.plugin).toBe("delivery-probe");
		expect(source.routes).toContainEqual(expect.objectContaining({ agent: "main", binding: "group", wake: "run" }));
		await expect.poll(() => probe.contexts.some((ctx) => ctx.agent === "main"), { timeout: 5000 }).toBe(true);
		const ctx = probe.contexts.find((item) => item.agent === "main");
		if (!ctx) throw Error("Alternative provider's actual run did not reach beforeRequest");
		expect(ctx.profile).toBe("group");
		expect(ctx.signal.aborted).toBe(false);
		expect(
			await probe.api.messages.send({ owner: owner(ctx), to: mainConv, text: "替换策略的正常回答" }),
		).toMatchObject({ ok: true });
		expect(probe.sent).toEqual([{ to: mainConv, text: "替换策略的正常回答" }]);
		expect((await kernel.events.query({ type: "social.group-turn" })).events).toEqual([]);
		expect((await kernel.events.query({ type: "social.rule-match" })).events).toEqual([]);
	} finally {
		await fixture.close();
	}
});
