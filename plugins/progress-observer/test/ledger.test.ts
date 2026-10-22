import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { Ledger, safeFallback } from "../src/ledger.js";

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
});
