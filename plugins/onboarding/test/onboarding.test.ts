import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkPlugin } from "@yonder/sdk/testing";
import { expect, test } from "vitest";
import { checklist, ITEMS, MAX_WAKES, missingTodo, StateFile, shouldWake, WAKE_INTERVAL_MS } from "../src/index.js";

test("manifest registrations match", async () => {
	expect(await checkPlugin(join(import.meta.dirname, ".."))).toEqual([]);
});

test("checklist maps host facts in order and keeps recorded tasks", () => {
	const items = checklist(
		{
			model: { default: "siliconflow/x", session: "siliconflow/x", known: true, authConfigured: false },
			channels: [{ instance: "cli", type: "cli", login: false }],
			plugins: [{ id: "tasks", use: "@yonder/plugin-tasks" }],
			shippedChannels: [{ type: "feishu", plugin: "@yonder/plugin-channel-feishu" }],
			gateway: { enabled: true },
			credentials: [],
		},
		{ tasks: { model: { id: "t-1", list: "tasks" } } },
	);
	expect(items.map((item) => item.id)).toEqual([...ITEMS]);
	expect(items.map((item) => item.state)).toEqual(["todo", "optional", "ok", "todo", "ok"]);
	expect(items[0]).toMatchObject({ task: { id: "t-1" }, detail: expect.stringContaining("缺少凭据") });
	expect(items[1]!.detail).toContain("feishu");
});

test("wakes are bounded: daily, five in total, never without model auth or after done/dismissed/opt-out", () => {
	const now = Date.parse("2026-10-28T00:00:00Z");
	expect(shouldWake({ tasks: {} }, now, true, true)).toBe(true);
	expect(shouldWake({ tasks: {} }, now, true, false)).toBe(false);
	expect(shouldWake({ tasks: {} }, now, false, true)).toBe(false);
	expect(shouldWake({ tasks: {}, done: "x" }, now, true, true)).toBe(false);
	expect(shouldWake({ tasks: {}, dismissed: "x" }, now, true, true)).toBe(false);
	const last = new Date(now - WAKE_INTERVAL_MS + 1).toISOString();
	expect(shouldWake({ tasks: {}, wakes: 1, lastWake: last }, now, true, true)).toBe(false);
	expect(shouldWake({ tasks: {}, wakes: 1, lastWake: last }, now + 1, true, true)).toBe(true);
	// A model that fails every run: the counter alone stops the loop, whatever the runs did.
	let state = { tasks: {}, wakes: 0 } as { tasks: object; wakes: number; lastWake?: string };
	let woke = 0;
	for (let day = 0; day < 30; day++) {
		const at = now + day * WAKE_INTERVAL_MS;
		if (shouldWake(state, at, true, true)) {
			woke++;
			state = { ...state, wakes: state.wakes + 1, lastWake: new Date(at).toISOString() };
		}
	}
	expect(woke).toBe(MAX_WAKES);
});

test("recorded todo tasks that vanished or were deleted count as missing", () => {
	const lists = new Map([
		[
			"2",
			new Map([
				["1", "todo"],
				["2", "cancelled"],
			]),
		],
	]);
	expect(missingTodo({ id: "1", list: "todo", session: "2" }, lists)).toBe(false);
	expect(missingTodo({ id: "2", list: "todo", session: "2" }, lists)).toBe(true);
	expect(missingTodo({ id: "3", list: "todo", session: "2" }, lists)).toBe(true);
	expect(missingTodo({ id: "1", list: "todo", session: "9" }, lists)).toBe(true);
	expect(missingTodo({ id: "x", list: "tasks" }, lists)).toBe(false);
});

test("state file is resumable, serializes updates and rejects path-like agent ids", async () => {
	const directory = await mkdtemp(join(tmpdir(), "onboarding-state-"));
	try {
		const states = new StateFile(directory);
		expect(await states.read("main")).toEqual({ tasks: {} });
		await Promise.all(
			ITEMS.map((item, index) =>
				states.update("main", (state) => ({
					...state,
					tasks: { ...state.tasks, [item]: { id: String(index), list: "tasks" as const } },
				})),
			),
		);
		expect(Object.keys((await new StateFile(directory).read("main")).tasks).sort()).toEqual([...ITEMS].sort());
		await expect(states.read("../x")).rejects.toThrow("Invalid agent id");
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
