import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionInfo } from "../src/work/api/types";

const base: SessionInfo = { id: "1", agent: null, profile: "default", mode: "task", key: "", version: "1", opened: "" };
const task = (id: string, opened: string, patch: Partial<SessionInfo> = {}): SessionInfo => ({
	...base,
	id,
	opened,
	...patch,
});
const bot = (id: string, patch: Partial<SessionInfo> = {}): SessionInfo => ({
	...base,
	id,
	agent: "main",
	profile: "owner",
	mode: "main",
	key: "main",
	...patch,
});

beforeEach(() => {
	vi.resetModules();
	const values = new Map<string, string>();
	vi.stubGlobal("localStorage", {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => values.set(key, value),
	});
});

describe("taskStatus", () => {
	it.each([
		[undefined, undefined, "idle"],
		[undefined, "running", "running"],
		[undefined, "waiting", "waiting"],
		[undefined, "idle", "idle"],
		[undefined, "error", "idle"],
		["2026-10-28T10:00:00.000Z", "running", "done"],
		["2026-10-28T10:00:00.000Z", undefined, "done"],
	] as const)("closed=%s with activity %s is %s", async (closed, state, expected) => {
		const { taskStatus } = await import("../src/work/lib/work");
		expect(taskStatus(task("1", "2026-10-01T00:00:00.000Z", closed ? { closed } : {}), state)).toBe(expected);
	});
});

describe("groupWork", () => {
	it("separates bots from tasks and drops closed bots and imported sessions", async () => {
		const { groupWork } = await import("../src/work/lib/work");
		const sessions = [
			bot("b1"),
			bot("b2", { closed: "2026-10-02T00:00:00.000Z" }),
			{ ...bot("i1"), agent: "imports.pi", mode: "main" },
			task("t1", "2026-10-01T00:00:00.000Z"),
			task("t2", "2026-10-03T00:00:00.000Z", { closed: "2026-10-04T00:00:00.000Z" }),
		];
		const { bots, byStatus } = groupWork(sessions);
		expect(bots.map((s) => s.id)).toEqual(["b1"]);
		expect(byStatus.idle.map((s) => s.id)).toEqual(["t1"]);
		expect(byStatus.done.map((s) => s.id)).toEqual(["t2"]);
		expect(byStatus.running).toEqual([]);
		expect(byStatus.waiting).toEqual([]);
	});

	it("buckets tasks by activity and sorts each bucket newest-opened first", async () => {
		const { groupWork } = await import("../src/work/lib/work");
		const sessions = [
			task("a", "2026-10-01T00:00:00.000Z"),
			task("b", "2026-10-05T00:00:00.000Z"),
			task("c", "2026-10-03T00:00:00.000Z"),
			task("d", "2026-10-02T00:00:00.000Z"),
		];
		const state = new Map([
			["b", { id: "b", state: "running" as const, since: "2026-10-05T01:00:00.000Z" }],
			["c", { id: "c", state: "waiting" as const, since: "2026-10-03T01:00:00.000Z" }],
		]);
		const { byStatus } = groupWork(sessions, state);
		expect(byStatus.running.map((s) => s.id)).toEqual(["b"]);
		expect(byStatus.waiting.map((s) => s.id)).toEqual(["c"]);
		expect(byStatus.idle.map((s) => s.id)).toEqual(["d", "a"]);
	});

	it("counts every task for the progress bar", async () => {
		const { groupWork, progressOf } = await import("../src/work/lib/work");
		const sessions = [
			task("a", "2026-10-01T00:00:00.000Z"),
			task("b", "2026-10-02T00:00:00.000Z", { closed: "2026-10-03T00:00:00.000Z" }),
			task("c", "2026-10-04T00:00:00.000Z", { closed: "2026-10-05T00:00:00.000Z" }),
		];
		expect(progressOf(groupWork(sessions).byStatus)).toEqual({ total: 3, done: 2 });
		expect(progressOf(groupWork([]).byStatus)).toEqual({ total: 0, done: 0 });
	});
});

describe("folds", () => {
	it("collapses only done by default", async () => {
		const { defaultOpen, isOpen } = await import("../src/work/lib/work");
		expect(["running", "waiting", "idle", "bot"].map((k) => defaultOpen(k as "bot"))).toEqual([true, true, true, true]);
		expect(defaultOpen("done")).toBe(false);
		expect(isOpen({}, "done")).toBe(false);
		expect(isOpen({ done: true }, "done")).toBe(true);
		expect(isOpen({ running: false }, "running")).toBe(false);
	});

	it("toggles without mutating the previous state", async () => {
		const { toggleFold } = await import("../src/work/lib/work");
		const before = {};
		expect(toggleFold(before, "done")).toEqual({ done: true });
		expect(toggleFold({ done: true }, "done")).toEqual({ done: false });
		expect(toggleFold({ running: false }, "bot")).toEqual({ running: false, bot: false });
		expect(before).toEqual({});
	});

	it.each([
		[null, {}],
		["", {}],
		["not json", {}],
		["[]", {}],
		['"done"', {}],
		["null", {}],
		['{"done":true,"idle":false}', { done: true, idle: false }],
		['{"done":"yes","running":1,"idle":false}', { idle: false }],
		['{"unknown":true,"bot":false}', { bot: false }],
	] as const)("parses %s as %o", async (raw, expected) => {
		const { parseFolds } = await import("../src/work/lib/work");
		expect(parseFolds(raw)).toEqual(expected);
	});

	it("persists manual toggles across reloads", async () => {
		const first = await import("../src/work/lib/work");
		expect(first.isOpen(first.parseFolds(localStorage.getItem("yonder.work.fold")), "done")).toBe(false);
		first.toggleFolds("done");
		first.toggleFolds("bot");
		expect(JSON.parse(localStorage.getItem("yonder.work.fold") ?? "null")).toEqual({ done: true, bot: false });

		vi.resetModules();
		const second = await import("../src/work/lib/work");
		const folds = second.parseFolds(localStorage.getItem("yonder.work.fold"));
		expect(second.isOpen(folds, "done")).toBe(true);
		expect(second.isOpen(folds, "bot")).toBe(false);
		expect(second.isOpen(folds, "running")).toBe(true);
	});
});
