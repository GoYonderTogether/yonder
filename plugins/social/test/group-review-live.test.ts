import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { openKernel } from "../../../packages/core/src/kernel/index.js";
import { openDatabase } from "../../../packages/core/src/runtime/db.js";
import { groupFixture, mainConv } from "./group-fixture.js";

const authSource = process.env.YONDER_GROUP_AUTH_SOURCE ?? process.env.YONDER_TEST_AUTH;
const snapshot = process.env.YONDER_GROUP_REVIEW_SNAPSHOT;
const enabled =
	process.env.YONDER_GROUP_REAL === "1" && !!authSource && existsSync(authSource) && !!snapshot && existsSync(snapshot);
test.skipIf(!enabled)(
	"real Luna reviews recorded public group material once and atomically applies its own bounded trigger proposal",
	async () => {
		const recorded = JSON.parse(await readFile(snapshot!, "utf8")) as {
			state: {
				candidates: Array<{ id: string; identity: string; focus: string[] }>;
				messages: Array<{ event?: string; text?: string; sender?: string }>;
			};
		};
		const fixture = await groupFixture({
			social: true,
			authSource,
			model: "openai/gpt-6-luna",
			initialRules: { main: { keywords: [], count: 1 } },
			identities: { main: JSON.stringify(recorded.state.candidates.find((c) => c.id === "jarvis")) },
		});
		const { probe, kernel } = fixture;
		let restarted: Awaited<ReturnType<typeof openKernel>> | undefined;
		try {
			const actual = recorded.state.messages.filter((m) => m.text?.trim()).slice(-25);
			expect(actual.length).toBeGreaterThanOrEqual(20);
			for (const item of actual)
				await probe.ios["qq-main"].emit({
					type: "message.in",
					from: "acct:qq-main:owner",
					conv: mainConv,
					data: {
						kind: "group",
						text: item.text!,
						msgId: randomUUID(),
						replay: { sourceEvent: item.event, sender: item.sender },
					},
				});
			await kernel.close();
			restarted = await openKernel(fixture.home);
			await expect
				.poll(async () => (await restarted!.events.query({ type: "social.rules-review-result" })).events.length, {
					timeout: 90000,
					interval: 250,
				})
				.toBe(1);
			const results = (await restarted.events.query({ type: "social.rules-review-result" })).events;
			const changes = (await restarted.events.query({ type: "social.rules-change" })).events;
			const database = await openDatabase(join(fixture.home, ".yonder/state.db"), true);
			let observations: unknown[] = [];
			try {
				const rows = await database.all<{ record: string }>("SELECT record FROM pi_entries ORDER BY id");
				observations = rows
					.map((r) => JSON.parse(r.record))
					.filter((r) => r.kind === "pi.model-observation")
					.map((r) => r.data);
			} finally {
				await database.close();
			}
			const evidence = {
				source:
					"recorded public QQ snapshot replay in actual kernel; isolated cheap review; local transport, no platform send",
				results,
				changes,
				observations,
			};
			if (process.env.YONDER_GROUP_REVIEW_EVIDENCE)
				await writeFile(process.env.YONDER_GROUP_REVIEW_EVIDENCE, JSON.stringify(evidence, null, 2), { mode: 0o600 });
			console.info("group-review-live", JSON.stringify(evidence));
			expect(results).toHaveLength(1);
			expect(results[0]?.data).toMatchObject({ status: "done" });
			expect(changes).toHaveLength(1);
			expect(changes[0]?.data).toMatchObject({ replay: { errors: 0 } });
			expect((await restarted.events.query({ type: "social.rules-review-start" })).events).toHaveLength(1);
			await restarted.close();
			restarted = await openKernel(fixture.home);
			expect((await restarted.events.query({ type: "social.rules-review-start" })).events).toHaveLength(1);
			expect(probe.sent).toEqual([]);
		} finally {
			await restarted?.close();
			await fixture.close();
		}
	},
	120000,
);
