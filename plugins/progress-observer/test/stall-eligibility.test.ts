import { expect, it } from "vitest";
import { isStallEligible } from "../src/index.js";

it("uses the business clock for threshold edges and excludes active/done executors", () => {
	const task = { executorSession: "child", executor: "interrupted", lastExecutorEventAt: 10_000 };
	expect(isStallEligible(task, 49_999, 40_000)).toBe(false);
	expect(isStallEligible(task, 50_000, 40_000)).toBe(true);
	expect(isStallEligible({ ...task, executor: "active" }, 49_999, 40_000)).toBe(false);
	expect(isStallEligible({ ...task, executor: "active" }, 50_000, 40_000)).toBe(true);
	expect(isStallEligible({ ...task, executor: "done" }, 90_000, 40_000)).toBe(false);
	expect(isStallEligible({ ...task, lastMilestoneAt: 80_000 }, 90_000, 40_000)).toBe(false);
	expect(isStallEligible({ ...task, lastMilestoneAt: 80_000 }, 120_000, 40_000)).toBe(true);
	expect(isStallEligible({ ...task, executorSession: undefined }, 90_000, 40_000)).toBe(false);
});
