import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { expect, test } from "vitest";
import { gptConv, groupFixture, mainConv } from "./group-fixture.js";

const authSource = process.env.YONDER_GROUP_AUTH_SOURCE ?? process.env.YONDER_TEST_AUTH;
const enabled = process.env.YONDER_GROUP_REAL === "1" && !!authSource && existsSync(authSource);

test.skipIf(!enabled)(
	"real inexpensive room judgment aborts active unselected residents and prevents old delivery",
	async () => {
		const fixture = await groupFixture({ social: true, authSource, model: "openai/gpt-6-luna" });
		const { kernel, probe } = fixture;
		try {
			const emit = (instance: string, conv: string, mentioned: boolean, text: string) =>
				probe.ios[instance].emit({
					type: "message.in",
					from: `acct:${instance}:owner`,
					conv,
					data: { kind: "group", mentioned, text, msgId: randomUUID(), social: { mentions: { bot: mentioned } } },
				});
			await emit("qq-gpt", gptConv, true, "在吗");
			await emit("qq-main", mainConv, true, "在吗");
			await expect.poll(() => probe.contexts.filter((ctx) => ctx.agent).length, { timeout: 10000 }).toBe(2);
			await emit("qq-main", mainConv, false, "GPT 和 Jarvis 你们两个闭嘴，禁言");
			await emit("qq-gpt", gptConv, false, "GPT 和 Jarvis 你们两个闭嘴，禁言");
			await expect
				.poll(async () => (await kernel.events.query({ type: "social.group-judgment" })).events.length, {
					timeout: 90000,
					interval: 250,
				})
				.toBe(1);
			const fact = (await kernel.events.query({ type: "social.group-judgment" })).events[0];
			if (process.env.YONDER_GROUP_CANCEL_EVIDENCE)
				await writeFile(
					process.env.YONDER_GROUP_CANCEL_EVIDENCE,
					JSON.stringify(
						{ source: "actual social plugin, cheap Luna, local transport; no QQ/Web outbound", fact },
						null,
						2,
					),
					{ mode: 0o600 },
				);
			expect(fact?.data).toMatchObject({ applied: true, silenced: expect.arrayContaining(["main", "gpt-senpai"]) });
			await expect
				.poll(() => probe.contexts.filter((ctx) => ctx.agent).every((ctx) => ctx.signal.aborted), { timeout: 10000 })
				.toBe(true);
			for (const ctx of probe.contexts.filter((item) => item.agent)) {
				const to = ctx.agent === "main" ? mainConv : gptConv;
				await expect(
					probe.api.messages.send({
						owner: { session: ctx.session, agent: ctx.agent, profile: ctx.profile },
						to,
						text: "不应发送的旧草稿",
					}),
				).rejects.toThrow("群聊草稿");
			}
			expect(probe.sent).toEqual([]);
			expect((await kernel.events.query({ type: "message.out" })).events).toEqual([]);
		} finally {
			await fixture.close();
		}
	},
	120000,
);
