import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, test } from "vitest";
import { groupFixture, mainConv } from "./group-fixture.js";

const authSource = process.env.YONDER_GROUP_AUTH_SOURCE ?? process.env.YONDER_TEST_AUTH;
const enabled = process.env.YONDER_GROUP_REAL === "1" && !!authSource && existsSync(authSource);

test.skipIf(!enabled)(
	"real Luna successful native reply activates a short follow-up after run end without a judge call",
	async () => {
		const f = await groupFixture({ social: true, authSource, model: "openai/gpt-6-luna", allowProvider: true });
		const release = setInterval(() => {
			for (const resume of f.probe.releases.values()) resume();
		}, 25);
		try {
			await f.probe.ios["qq-main"].emit({
				type: "message.in",
				from: "acct:qq-main:owner",
				conv: mainConv,
				data: {
					kind: "group",
					text: "请回答：一小时有多少分钟？请在群里只发一句简短回答。",
					msgId: randomUUID(),
					mentioned: true,
				},
			});
			await expect.poll(() => f.probe.contexts.length, { timeout: 10000 }).toBe(1);
			const first = f.probe.contexts[0]!;
			f.probe.releases.get(first.session)?.();
			await expect
				.poll(async () => (await f.kernel.events.query({ type: "run.end" })).events.length, { timeout: 90000 })
				.toBe(1);
			const sent = (await f.kernel.events.query({ type: "message.out", conv: mainConv })).events;
			expect(
				sent.some((e) => e.from === "agent:main" && (e.data as { delivery?: { ok?: boolean } }).delivery?.ok),
			).toBe(true);
			await f.probe.ios["qq-main"].emit({
				type: "message.in",
				from: "acct:qq-main:owner",
				conv: mainConv,
				data: { kind: "group", text: "那半小时呢", msgId: randomUUID(), mentioned: false },
			});
			await expect
				.poll(async () => (await f.kernel.events.query({ type: "social.batch-ready", conv: mainConv })).events.length, {
					timeout: 19000,
				})
				.toBe(1);
			await expect
				.poll(async () => (await f.kernel.events.query({ type: "run.end" })).events.length, { timeout: 60000 })
				.toBe(2);
			expect(f.probe.sent.length).toBeGreaterThan(sent.length);
			const facts = (await f.kernel.events.query({ type: "social.rule-match", conv: mainConv })).events;
			expect(facts).toHaveLength(1);
			expect(facts[0]?.data).toMatchObject({ matched: true, focused: true, counter: 0 });
			expect((await f.kernel.events.query({ type: "social.judge-start" })).events).toEqual([]);
		} finally {
			clearInterval(release);
			if (process.env.YONDER_GROUP_ATTENTION_EVIDENCE) {
				const db = new DatabaseSync(join(f.home, ".yonder/state.db"), { readOnly: true });
				try {
					const observations = db
						.prepare("SELECT record FROM pi_entries WHERE json_extract(record, '$.kind') = 'pi.model-observation'")
						.all()
						.map((r) => {
							const d = JSON.parse(String(r.record)).data;
							return {
								phase: d.phase,
								operation: d.operation,
								status: d.status,
								selected: d.selected,
								elapsedMs: d.elapsedMs,
								errorClass: d.errorClass,
								usage: d.usage,
							};
						});
					await writeFile(
						process.env.YONDER_GROUP_ATTENTION_EVIDENCE,
						JSON.stringify(
							{
								observations,
								contexts: f.probe.contexts.length,
								sent: f.probe.sent,
								events: (await f.kernel.events.query({ limit: 1000 })).events.map((e) => ({ type: e.type, at: e.ts })),
							},
							null,
							2,
						),
						{ mode: 0o600 },
					);
				} finally {
					db.close();
				}
			}
			await f.close();
		}
	},
	120000,
);
