import { randomUUID } from "node:crypto";
import type { ExecutionOwner, ToolContext } from "@yonder/sdk";
import { expect, test } from "vitest";
import { gptConv, groupFixture, mainConv, privateConv } from "./group-fixture.js";

const owner = (ctx: ToolContext): ExecutionOwner => ({ session: ctx.session, agent: ctx.agent, profile: ctx.profile });

test("real owned group delivery allows addressed target across aliases, rejects stale residents and leaves private delivery alone", async () => {
	const fixture = await groupFixture();
	const { kernel, probe } = fixture;
	try {
		const emit = (instance: string, conv: string, mentioned: boolean) =>
			probe.ios[instance].emit({
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
		await emit("qq-gpt", gptConv, true);
		await expect.poll(() => probe.contexts.some((ctx) => ctx.agent === "gpt-senpai"), { timeout: 5000 }).toBe(true);
		const gpt = probe.contexts.find((ctx) => ctx.agent === "gpt-senpai");
		if (!gpt) throw new Error("Real GPT request context missing");
		await emit("qq-main", mainConv, true);
		await expect.poll(() => probe.contexts.some((ctx) => ctx.agent === "main"), { timeout: 5000 }).toBe(true);
		const main = probe.contexts.find((ctx) => ctx.agent === "main");
		if (!main) throw new Error("Real main request context missing");
		// A real request hook context still cannot impersonate an actual native tool invocation.
		expect(await probe.api.messages.send({ to: mainConv, text: "不能绕过工具调用边界" }, main)).toMatchObject({
			ok: false,
			error: expect.stringContaining("真实运行中的工具调用上下文"),
		});
		// A later addressed resident invalidates a prior resident's stale grant in the same mapped room.
		await expect(probe.api.messages.send({ owner: owner(gpt), to: gptConv, text: "旧回答不应发出" })).rejects.toThrow(
			"群聊草稿",
		);
		await emit("qq-gpt", gptConv, false);
		probe.onRequest = async (ctx) => {
			if (ctx.session === main.session)
				probe.results.push(
					await probe.api.messages.send({ owner: owner(ctx), to: mainConv, text: "目标 Bot 的本轮回答" }),
				);
		};
		probe.releases.get(main.session)?.();
		await expect.poll(() => probe.results.length, { timeout: 5000 }).toBe(1);
		expect(probe.results[0], JSON.stringify(probe.results[0])).toMatchObject({ ok: true });
		expect(probe.sent).toEqual([{ to: mainConv, text: "目标 Bot 的本轮回答" }]);
		await emit("qq-main", mainConv, false);
		await expect(probe.api.messages.send({ owner: owner(main), to: mainConv, text: "已失效的旧回答" })).rejects.toThrow(
			"群聊草稿",
		);
		const privateSource = await emit("qq-main", privateConv, false);
		const privateSession = privateSource.routes?.find((route) => route.agent === "main" && !route.dropped)?.session;
		if (!privateSession) throw new Error("Real private write session missing");
		expect(
			await probe.api.messages.send({
				owner: { session: privateSession, agent: "main", profile: "private" },
				to: privateConv,
				text: "私聊不受群调度限制",
			}),
		).toMatchObject({ ok: true });
		expect(probe.sent).toHaveLength(2);
		expect((await kernel.events.query({ type: "message.out" })).events).toHaveLength(2);
	} finally {
		await fixture.close();
	}
}, 30000);
