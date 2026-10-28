import { fileURLToPath } from "node:url";
import { checkPlugin, createRegistrationCollector } from "@yonder/sdk/testing";
import { Check } from "typebox/value";
import { expect, it } from "vitest";
import plugin from "../src/index.js";

it("satisfies the plugin contract", async () => {
	expect(await checkPlugin(fileURLToPath(new URL("..", import.meta.url)))).toEqual([]);
});

it("task card schema keeps optional coordination fields bounded and rejects extra keys", async () => {
	const collector = createRegistrationCollector();
	await plugin.setup(collector.api);
	const schema = collector.registrations.tools.find((tool) => tool.name === "channel-feishu_task_card")?.parameters;
	if (!schema) throw new Error("missing task card schema");
	const row = { id: "task-ref", status: "unverified", deliverable: "交付物", acceptance: "验收点" };
	const args = { instance: "feishu", action: "create", sourceEvent: "input", rows: [row] };
	expect(Check(schema, args)).toBe(true);
	expect(
		Check(schema, {
			...args,
			rows: [{ ...row, assignee: "maintainer", forwardedVerbatim: true }],
			lists: { advancing: ["测试"], needsOwner: [] },
		}),
	).toBe(true);
	for (const invalid of [
		{ ...args, extra: true },
		{ ...args, instance: "" },
		{ ...args, sourceEvent: "" },
		{ instance: "feishu", action: "get", id: "" },
		{ ...args, rows: [{ ...row, authority: true }] },
		{ ...args, rows: [{ ...row, forwardedVerbatim: "yes" }] },
		{ ...args, rows: [{ ...row, assignee: "x".repeat(81) }] },
		{ ...args, rows: Array(13).fill(row) },
		{ ...args, rows: [] },
		{ ...args, lists: { execute: [] } },
		{ ...args, lists: { advancing: Array(4).fill("x") } },
		{ ...args, lists: { needsOwner: ["x".repeat(161)] } },
		{ ...args, rows: [{ ...row, status: "arbitrary prose" }] },
	])
		expect(Check(schema, invalid)).toBe(false);
});
