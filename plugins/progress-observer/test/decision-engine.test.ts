import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { runDecision } from "../src/decision-engine.js";
import { Ledger } from "../src/ledger.js";

describe("decision boundary", () => {
	it("validates malformed output, honors quiet/rate limits and preserves pending on skip", async () => {
		const dir = await mkdtemp(join(tmpdir(), "observer-decision-"));
		try {
			const ledger = await new Ledger(dir).open();
			await ledger.create("a", "task");
			await ledger.event({ id: "fact", task: "a", type: "executor.active", at: 1 });
			const send = vi.fn(async () => "sent" as const);
			const skip = { decision: "skip", evidence: [], text: "" };
			await runDecision(
				{ ledger, decide: async () => undefined, send, boundTarget: "target", minimumIntervalMs: 5 },
				"a",
				2,
			);
			expect(send).not.toHaveBeenCalled();
			await runDecision(
				{ ledger, decide: async () => skip, send, boundTarget: "target", minimumIntervalMs: 5 },
				"a",
				2,
			);
			expect((await ledger.list())[0]?.pending).toEqual(["fact"]);
			await ledger.event({ id: "quiet", task: "a", type: "quiet", at: 3, until: 50 });
			await runDecision(
				{ ledger, decide: async () => skip, send, boundTarget: "target", minimumIntervalMs: 5 },
				"a",
				4,
			);
			expect(send).not.toHaveBeenCalled();
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
	it("durably claims before send and never retries unknown receipts after restart", async () => {
		const dir = await mkdtemp(join(tmpdir(), "observer-decision-"));
		try {
			let ledger = await new Ledger(dir).open();
			await ledger.create("a", "task");
			await ledger.event({ id: "fact", task: "a", type: "executor.active", at: 1 });
			const send = vi.fn(async () => "unknown" as const);
			const opts = {
				ledger,
				decide: async () => ({ decision: "notify", evidence: ["fact"], text: "hello" }),
				send,
				boundTarget: "bound",
				minimumIntervalMs: 0,
			};
			await runDecision(opts, "a", 10);
			expect((await ledger.list())[0]?.lastSent).toBeUndefined();
			ledger = await new Ledger(dir).open();
			await runDecision({ ...opts, ledger }, "a", 20);
			expect(send).toHaveBeenCalledTimes(1);
			expect((await ledger.list())[0]?.pending).toContain("fact");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});
