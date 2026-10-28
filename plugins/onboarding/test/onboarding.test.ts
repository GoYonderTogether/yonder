import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkPlugin } from "@yonder/sdk/testing";
import { expect, test } from "vitest";
import { checklist, ITEMS, StateFile } from "../src/index.js";

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
		{ tasks: { model: "t-1" } },
	);
	expect(items.map((item) => item.id)).toEqual([...ITEMS]);
	expect(items.map((item) => item.state)).toEqual(["todo", "optional", "ok", "todo", "ok"]);
	expect(items[0]).toMatchObject({ task: "t-1", detail: expect.stringContaining("缺少凭据") });
	expect(items[1]!.detail).toContain("feishu");
});

test("state file is resumable and rejects path-like agent ids", async () => {
	const directory = await mkdtemp(join(tmpdir(), "onboarding-state-"));
	try {
		const states = new StateFile(directory);
		expect(await states.read("main")).toEqual({ tasks: {} });
		await states.write("main", { tasks: { gateway: "t-2" } });
		expect(await new StateFile(directory).read("main")).toEqual({ tasks: { gateway: "t-2" } });
		await expect(states.read("../x")).rejects.toThrow("Invalid agent id");
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
