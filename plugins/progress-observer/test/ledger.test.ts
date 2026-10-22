import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { Ledger, safeFallback } from "../src/ledger.js";
import { runDecision } from "../src/decision-engine.js";

const leaseHooks = vi.hoisted(() => ({ compromised: undefined as (() => void) | undefined }));
vi.mock("proper-lockfile", async (importOriginal) => {
	const actual = await importOriginal<typeof import("proper-lockfile")>();
	return {
		...actual,
		lock: async (path: string, options: Parameters<typeof actual.lock>[1]) => {
			leaseHooks.compromised = options.onCompromised;
			return actual.lock(path, options);
		},
	};
});

describe("durable progress facts", () => {
	it("deduplicates and resumes interruption without claiming completion", async () => {
		const d = await mkdtemp(join(tmpdir(), "observer-"));
		try {
			let l = await new Ledger(d).open();
			await l.create("a", "alpha");
			await l.event({ id: "e1", task: "a", type: "executor.interrupted", at: 1 });
			await l.event({ id: "e1", task: "a", type: "executor.active", at: 2 });
			expect((await l.list())[0].executor).toBe("interrupted");
			expect(safeFallback((await l.list())[0]).decision).toBe("notify");
			await l.close();
			await l.close();
			l = await new Ledger(d).open();
			expect((await l.list())[0].executor).toBe("interrupted");
			await l.close();
		} finally {
			await rm(d, { recursive: true, force: true });
		}
	});
	it("maps real terminal run statuses without turning a successful run into acceptance", async () => {
		const d = await mkdtemp(join(tmpdir(), "observer-"));
		try {
			const l = await new Ledger(d).open();
			await l.create("a", "alpha");
			await l.event({ id: "interrupted", task: "a", type: "run.end", at: 10, value: "aborted" });
			expect((await l.list())[0]).toMatchObject({ executor: "interrupted", runStatus: "aborted", accepted: "unknown" });
			expect(safeFallback((await l.list())[0]).decision).toBe("notify");
			await l.event({ id: "finished", task: "a", type: "run.end", at: 20, value: "done" });
			expect((await l.list())[0]).toMatchObject({ executor: "done", accepted: "unknown" });
			await l.close();
		} finally {
			await rm(d, { recursive: true, force: true });
		}
	});
	it("quiet and unknown receipt are respected; never auto-retry", async () => {
		const d = await mkdtemp(join(tmpdir(), "observer-"));
		try {
			const l = await new Ledger(d).open();
			await l.create("a", "alpha");
			await l.event({ id: "q", task: "a", type: "quiet", at: 1, until: 9999999999999 });
			await l.event({ id: "u", task: "a", type: "delivery.unknown", at: 2 });
			await expect(l.decision("a", { decision: "notify", evidence: ["u"], text: "test" }, 3)).rejects.toThrow("quiet");
			expect(safeFallback((await l.list())[0]).text).toContain("不会自动重发");
			await l.close();
		} finally {
			await rm(d, { recursive: true, force: true });
		}
	});

	it("fails closed after lease compromise and never invokes the sender", async () => {
		const d = await mkdtemp(join(tmpdir(), "observer-compromised-"));
		try {
			const l = await new Ledger(d).open();
			await l.create("a", "alpha");
			await l.event({ id: "e1", task: "a", type: "executor.interrupted", at: 1 });
			const list = l.list.bind(l);
			let reads = 0;
			vi.spyOn(l, "list").mockImplementation(async () => {
				reads += 1;
				if (reads === 2) leaseHooks.compromised?.();
				return list();
			});
			const send = vi.fn(async () => "sent" as const);
			await expect(
				runDecision(
					{
						ledger: l,
						decide: async () => ({ decision: "notify", evidence: ["e1"], text: "interrupted" }),
						send,
						boundTarget: "target",
						minimumIntervalMs: 0,
					},
					"a",
				),
			).rejects.toThrow("ledger lease unavailable or compromised");
			expect(send).not.toHaveBeenCalled();
			expect(leaseHooks.compromised).toBeTypeOf("function");
			await expect(l.create("b", "beta")).rejects.toThrow("ledger lease unavailable or compromised");
			await expect(l.event({ id: "e2", task: "a", type: "milestone", at: 2, value: "x" })).rejects.toThrow(
				"ledger lease unavailable or compromised",
			);
			await expect(l.decision("a", { decision: "notify", evidence: ["e1"], text: "again" })).rejects.toThrow(
				"ledger lease unavailable or compromised",
			);
			expect((await list()).find((task) => task.id === "b")).toBeUndefined();
			expect((await list())[0].milestone).toBeUndefined();
			await l.close();
			await l.close();
		} finally {
			leaseHooks.compromised = undefined;
			await rm(d, { recursive: true, force: true });
		}
	});
});
