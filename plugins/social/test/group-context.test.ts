import { randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { groupFixture, mainConv } from "./group-fixture.js";

const message = (text: string, mentioned = false) => ({
	type: "message.in",
	from: "acct:qq-main:owner",
	conv: mainConv,
	data: { kind: "group", text, msgId: randomUUID(), mentioned, social: { mentions: { bot: mentioned } } },
});
const flat = (content: unknown) =>
	Array.isArray(content)
		? content.map((part) => (part && typeof part === "object" && "text" in part ? String(part.text) : "")).join("\n")
		: String(content ?? "");

test("a group turn injects one compact context block with self, senders, coverage and opportunity", async () => {
	const f = await groupFixture({ social: true, officialGroup: true });
	const { kernel, probe } = f;
	try {
		await probe.ios["qq-main"].emit(message("在吗", true));
		await expect.poll(() => probe.contexts.length, { timeout: 8000 }).toBe(1);
		const messages = probe.messages[0] ?? [];
		const blocks = messages.filter((entry) => entry.role === "user").map((entry) => flat(entry.content));
		const social = blocks.filter((text) => text.includes("本群本轮事实"));
		// 一轮只有一条 social user context。
		expect(social).toHaveLength(1);
		const block = social[0]!;
		expect(block).toContain("self: main");
		expect(block).toContain("senders:");
		expect(block).toContain("covered:");
		expect(block).toContain("otherBots observed here:");
		expect(block).toContain("your opportunity:");
		// 批次自己带一份公开历史（就在本轮的批次 JSON 里），social 不再追加第二份。
		const history = blocks.filter((text) => text.includes("本群最近公开消息"));
		expect(history).toHaveLength(0);
		const batchText = blocks.filter((text) => text.includes('"publicHistory"'));
		expect(batchText).toHaveLength(1);
		expect(JSON.parse(batchText[0]!.slice(batchText[0]!.indexOf('{"agent"')))).toMatchObject({
			publicHistory: expect.any(Array),
		});
		// 房间索引的大字段不再每轮重复。
		expect(block).not.toContain('"people"');
		expect(block).not.toContain('"evidence"');
		// 内核不再为批次重复注入成员/recentSent。
		expect(blocks.join("\n")).not.toContain('"recentSent"');
		const batches = (await kernel.events.query({ type: "social.batch-ready", conv: mainConv })).events;
		const publicHistory = (batches[0]!.data as { publicHistory?: unknown[] }).publicHistory ?? [];
		expect(publicHistory.length).toBeGreaterThan(0);
		expect(publicHistory.length).toBeLessThanOrEqual(30);
	} finally {
		await f.close();
	}
}, 30000);

test("the compact block names the addressed recipient instead of letting the model guess", async () => {
	const f = await groupFixture({ social: true, officialGroup: true });
	try {
		await f.probe.ios["qq-main"].emit({
			...message("GPT 学姐，请看看方案", true),
			data: {
				kind: "group",
				text: "GPT 学姐，请看看方案",
				msgId: randomUUID(),
				mentioned: true,
				mentions: ["acct:qq-gpt:owner"],
				mentionNames: { "acct:qq-gpt:owner": "GPT 学姐" },
				social: { mentions: { bot: true } },
			},
		});
		await expect.poll(() => f.probe.contexts.length, { timeout: 8000 }).toBe(1);
		const block = (f.probe.messages[0] ?? [])
			.filter((entry) => entry.role === "user")
			.map((entry) => flat(entry.content))
			.find((text) => text.includes("本群本轮事实"));
		expect(block).toContain("addressedTo");
		expect(block).toContain("GPT 学姐");
	} finally {
		await f.close();
	}
}, 30000);
