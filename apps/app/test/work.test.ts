import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionInfo } from "../src/work/api/types";
import type { WorkSession } from "../src/work/lib/work";

const base: SessionInfo = { id: "1", agent: null, profile: "default", mode: "task", key: "", version: "1", opened: "" };
const task = (id: string, opened: string, patch: Partial<WorkSession> = {}): WorkSession => ({
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
		[{}, undefined, "idle"],
		[{}, "running", "running"],
		[{}, "waiting", "waiting"],
		[{}, "error", "idle"],
		[{ closed: "2026-10-28T10:00:00.000Z" }, "running", "done"],
		[{ archivedAt: 1 }, undefined, "done"],
		[{ needsOwner: { reason: "批准", since: 1 } }, undefined, "waiting"],
	] as const)("%o with activity %s is %s", async (patch, state, expected) => {
		const { taskStatus } = await import("../src/work/lib/work");
		expect(taskStatus(task("1", "2026-10-01T00:00:00.000Z", patch as Partial<WorkSession>), state)).toBe(expected);
	});

	it("kernel archivedAt counts as done even while running", async () => {
		const { taskStatus } = await import("../src/work/lib/work");
		expect(taskStatus(task("1", "", { archivedAt: 5 }), "running")).toBe("done");
	});
});

describe("timeKey", () => {
	it("buckets by local calendar day", async () => {
		const { timeKey } = await import("../src/work/lib/work");
		const now = new Date(2026, 9, 28, 12);
		expect(timeKey(new Date(2026, 9, 28, 1).toISOString(), now)).toBe("today");
		expect(timeKey(new Date(2026, 9, 27, 23).toISOString(), now)).toBe("yesterday");
		expect(timeKey(new Date(2026, 9, 20).toISOString(), now)).toBe("earlier");
		expect(timeKey("bad", now)).toBe("earlier");
	});
});

describe("groupWork", () => {
	const now = new Date(2026, 9, 28, 12);
	const at = (d: number) => new Date(2026, 9, d, 9).toISOString();

	it("separates bots from tasks and drops closed bots and imported sessions", async () => {
		const { groupWork } = await import("../src/work/lib/work");
		const g = groupWork(
			[
				bot("b1"),
				bot("b2", { closed: at(2) }),
				{ ...bot("i1"), agent: "imports.pi", mode: "main" },
				task("t1", at(28)),
				task("t2", at(27), { closed: at(28) }),
			],
			new Map(),
			{ now },
		);
		expect(g.bots.map((s) => s.id)).toEqual(["b1"]);
		expect(g.byTime.today.map((s) => s.id)).toEqual(["t1"]);
		expect(g.done.map((s) => s.id)).toEqual(["t2"]);
	});

	it("routes needs-you, running, pinned and time groups; pinned follows opened order", async () => {
		const { groupWork } = await import("../src/work/lib/work");
		const state = new Map([
			["b", { id: "b", state: "running" as const, since: "" }],
			["c", { id: "c", state: "waiting" as const, since: "" }],
		]);
		const g = groupWork(
			[
				task("a", at(20)),
				task("b", at(28)),
				task("c", at(27)),
				task("d", at(27)),
				task("p1", at(1), { pinned: true }),
				task("p2", at(2), { pinned: true }),
			],
			state,
			{ now },
		);
		expect(g.running.map((s) => s.id)).toEqual(["b"]);
		expect(g.needsYou.map((s) => s.id)).toEqual(["c"]);
		expect(g.pinned.map((s) => s.id)).toEqual(["p2", "p1"]);
		expect(g.byTime.yesterday.map((s) => s.id)).toEqual(["d"]);
		expect(g.byTime.earlier.map((s) => s.id)).toEqual(["a"]);
	});

	it("keeps bot-owned tasks under the bot unless handed up", async () => {
		const { groupWork } = await import("../src/work/lib/work");
		const owner = { kind: "bot" as const, id: "main" };
		const g = groupWork(
			[task("x", at(28), { owner }), task("y", at(28), { owner, needsOwner: { reason: "需要批准", since: 1 } })],
			new Map(),
			{ now },
		);
		expect(g.byTime.today).toEqual([]);
		expect(g.needsYou.map((s) => s.id)).toEqual(["y"]);
	});

	it("archived tasks go to done even when pinned", async () => {
		const { groupWork } = await import("../src/work/lib/work");
		const g = groupWork([task("a", at(28), { archivedAt: 1, pinned: true })], new Map(), { now });
		expect(g.done.map((s) => s.id)).toEqual(["a"]);
		expect(g.pinned).toEqual([]);
	});
});

describe("folds", () => {
	it("collapses done and runningMore by default", async () => {
		const { defaultOpen, isOpen } = await import("../src/work/lib/work");
		expect(defaultOpen("done")).toBe(false);
		expect(isOpen({ done: true }, "done")).toBe(true);
	});

	it("toggles without mutating the previous state", async () => {
		const { toggleFold } = await import("../src/work/lib/work");
		const before = {};
		expect(toggleFold(before, "done")).toEqual({ done: true });
		expect(toggleFold({ done: true }, "done")).toEqual({ done: false });
		expect(before).toEqual({});
	});

	it.each([
		[null, {}],
		["not json", {}],
		["[]", {}],
		['{"done":true,"idle":false}', { done: true }],
		['{"done":"yes","runningMore":true}', { runningMore: true }],
	] as const)("parses %s as %o", async (raw, expected) => {
		const { parseFolds } = await import("../src/work/lib/work");
		expect(parseFolds(raw)).toEqual(expected);
	});

	it("persists manual toggles across reloads", async () => {
		const first = await import("../src/work/lib/work");
		first.toggleFolds("done");
		vi.resetModules();
		const second = await import("../src/work/lib/work");
		expect(second.isOpen(second.parseFolds(localStorage.getItem("yonder.work.fold")), "done")).toBe(true);
	});
});
