import { expect, test, vi } from "vitest";
import { createTaskControl } from "./task-control.js";

test("task control restricts children and sends steer or resume to the original session", async () => {
	let status = "running";
	let parent = "1";
	const submit = vi.fn(async () => ({ session: "2", status: "done", text: "result" }));
	const runtime = {
		backgroundChild: async () => ({ session: "2", state: { status } }),
		backgroundAction: async () => ({ state: { status } }),
		hasPendingWork: async () => false,
	};
	const tool = createTaskControl({
		runtime: () => runtime,
		sessions: { api: { submit } },
		store: { sessions: { get: async () => ({ parent }) } },
	} as never);
	const ctx = { session: "1", signal: new AbortController().signal } as never;
	expect((await tool.execute({ action: "steer", id: "3", message: "adjust" }, ctx)).isError).toBeUndefined();
	expect(submit).toHaveBeenCalledWith("2", { text: "adjust" }, { wait: false, busy: "steer" });
	status = "terminal";
	expect((await tool.execute({ action: "resume", id: "3", message: "continue" }, ctx)).isError).toBeUndefined();
	expect(submit).toHaveBeenLastCalledWith("2", { text: "continue" }, { wait: true, busy: "steer" });
	parent = "other";
	expect((await tool.execute({ action: "status", id: "3" }, ctx)).isError).toBe(true);
});
