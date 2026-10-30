import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { expect, test } from "vitest";
import { gptConv, groupFixture, mainConv } from "./group-fixture.js";

const authSource = process.env.YONDER_GROUP_AUTH_SOURCE ?? process.env.YONDER_TEST_AUTH;
const enabled = process.env.YONDER_GROUP_REAL === "1" && !!authSource && existsSync(authSource);

test.skipIf(!enabled)(
	"real Luna sends through native message_send to its addressed group despite sibling alias input",
	async () => {
		const fixture = await groupFixture({ authSource, model: "openai/gpt-6-luna", allowProvider: true });
		const { kernel, probe } = fixture;
		try {
			await probe.ios["qq-main"].emit({
				type: "message.in",
				from: "acct:qq-main:owner",
				conv: mainConv,
				data: {
					kind: "group",
					text: "你们都在吗",
					mentioned: true,
					msgId: randomUUID(),
					social: { mentions: { bot: true } },
				},
			});
			await expect.poll(() => probe.contexts.some((ctx) => ctx.agent === "main"), { timeout: 10000 }).toBe(true);
			await probe.ios["qq-gpt"].emit({
				type: "message.in",
				from: "acct:qq-gpt:owner",
				conv: gptConv,
				data: {
					kind: "group",
					text: "你们都在吗",
					mentioned: false,
					msgId: randomUUID(),
					social: { mentions: { bot: false } },
				},
			});
			const ctx = probe.contexts.find((item) => item.agent === "main");
			if (!ctx) throw new Error("Real addressed group context was not reached");
			probe.releases.get(ctx.session)?.();
			await expect.poll(() => probe.sent.length, { timeout: 90000, interval: 250 }).toBe(1);
			expect(probe.sent[0]?.to).toBe(mainConv);
			await expect
				.poll(async () => (await kernel.events.query({ type: "message.out" })).events.length, { timeout: 5000 })
				.toBe(1);
			const outputs = (await kernel.events.query({ type: "message.out" })).events;
			expect(outputs).toHaveLength(1);
			expect(outputs[0]?.data).toMatchObject({ delivery: { ok: true } });
			if (process.env.YONDER_GROUP_TOOL_EVIDENCE)
				await writeFile(
					process.env.YONDER_GROUP_TOOL_EVIDENCE,
					JSON.stringify(
						{ source: "actual Luna native message_send; local recording transport; not platform acceptance", outputs },
						null,
						2,
					),
					{ mode: 0o600 },
				);
		} finally {
			await fixture.close();
		}
	},
	120000,
);
