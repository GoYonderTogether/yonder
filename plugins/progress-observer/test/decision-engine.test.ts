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
	it("allows only one concurrent decision to claim and send an evidence item", async () => {
		const dir = await mkdtemp(join(tmpdir(), "observer-race-"));
		try {
			const ledger = await new Ledger(dir).open();
			await ledger.create("race", "task");
			await ledger.event({ id: "fact", task: "race", type: "executor.active", at: 1 });
			let release!: () => void;
			const gate = new Promise<void>((resolve) => {
				release = resolve;
			});
			const decide = async () => {
				await gate;
				return { decision: "notify", evidence: ["fact"], text: "hello" };
			};
			const send = vi.fn(async () => "sent" as const);
			const options = { ledger, decide, send, boundTarget: "bound", minimumIntervalMs: 0 };
			const one = runDecision(options, "race", 10);
			const two = runDecision(options, "race", 10);
			release();
			await Promise.all([one, two]);
			expect(send).toHaveBeenCalledTimes(1);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
	it("cancels a claimed attempt if quiet changes before the send boundary, preserving pending", async () => {
		const dir = await mkdtemp(join(tmpdir(), "observer-cancel-"));
		try {
			const ledger = await new Ledger(dir).open();
			await ledger.create("a", "task");
			await ledger.event({ id: "fact", task: "a", type: "executor.active", at: 1 });
			const markSending = ledger.markSending.bind(ledger);
			vi.spyOn(ledger, "markSending").mockImplementation(async (id, attempt) => {
				await ledger.event({ id: "quiet-late", task: id, type: "quiet", at: 3, until: Date.now() + 60_000 });
				return markSending(id, attempt, 0);
			});
			const send = vi.fn(async () => "sent" as const);
			await runDecision(
				{
					ledger,
					decide: async () => ({ decision: "notify", evidence: ["fact"], text: "hello" }),
					send,
					boundTarget: "bound",
					minimumIntervalMs: 0,
				},
				"a",
				10,
			);
			expect(send).not.toHaveBeenCalled();
			const task = (await ledger.list())[0];
			expect(task).toBeDefined();
			if (!task) throw new Error("task missing");
			expect(task.delivery).toBe("not_sent");
			expect(task.pending).toContain("fact");
			expect(task.attempt).toBeUndefined();
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
	it("rejects cancellation of stale attempts and attempts past the send boundary", async () => {
		const dir = await mkdtemp(join(tmpdir(), "observer-cancel-"));
		try {
			const ledger = await new Ledger(dir).open();
			await ledger.create("a", "task");
			await ledger.event({ id: "fact", task: "a", type: "executor.active", at: 1 });
			const decision = { decision: "notify", evidence: ["fact"], text: "hello" } as const;
			const oldAttempt = await ledger.decision("a", decision, 10);
			if (!oldAttempt) throw new Error("attempt missing");
			await ledger.receipt("a", oldAttempt, "failed");
			await ledger.event({ id: "fact2", task: "a", type: "milestone", at: 2, value: "next" });
			const newAttempt = await ledger.decision("a", { ...decision, evidence: ["fact2"] }, 20);
			if (!newAttempt) throw new Error("attempt missing");
			expect(await ledger.cancelBeforeSend("a", oldAttempt)).toBe(false);
			expect(await ledger.markSending("a", newAttempt, 0)).toBe(true);
			expect(await ledger.cancelBeforeSend("a", newAttempt)).toBe(false);
			expect((await ledger.list())[0]?.delivery).toBe("unknown");
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
