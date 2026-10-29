import { expect, test } from "vitest";
import { closeOnRunEnd } from "./close-policy.js";

test("ephemeral sessions close after every run, task sessions only after a successful one", () => {
	for (const status of ["done", "error", "limit", "aborted"] as const)
		expect(closeOnRunEnd("ephemeral", status)).toBe(status === "done" ? "completed" : status);
	// 失败/中断的运行不关 task 会话：后台回报和主人的「继续」都还要落回同一会话（10 §运行保证）。
	expect(closeOnRunEnd("task", "done")).toBe("completed");
	for (const status of ["error", "limit", "aborted"] as const) expect(closeOnRunEnd("task", status)).toBeUndefined();
	// 一轮一关的策略里，close: manual 的会话本来就不随运行结束关闭。
	expect(closeOnRunEnd("task", "done", "manual")).toBeUndefined();
	expect(closeOnRunEnd("task", "done", "run-end")).toBe("completed");
	// 主会话与常驻会话不随运行结束关闭。
	for (const mode of ["main", "persistent"] as const)
		for (const status of ["done", "error", "limit", "aborted"] as const)
			expect(closeOnRunEnd(mode, status)).toBeUndefined();
});
