import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { createSubagentTool } from "../kernel/subagents.js";
import { createCoreTools } from "./index.js";

const path = new URL("./delegation.golden.json", import.meta.url);
type Schema = Record<string, unknown>;

function compatible(before: Schema, current: Schema): void {
	for (const required of (current.required ?? []) as string[])
		expect((before.required ?? []) as string[]).toContain(required);
	for (const [key, value] of Object.entries(before)) {
		if (key === "required") continue;
		if (Array.isArray(value)) {
			expect(current[key]).toEqual(expect.arrayContaining(value));
		} else if (value && typeof value === "object") {
			expect(current[key]).toBeDefined();
			compatible(value as Schema, current[key] as Schema);
		} else {
			expect(current[key]).toEqual(value);
		}
	}
}

test("delegation tool schemas remain additive", () => {
	const options = { presets: () => [] } as unknown as Parameters<typeof createCoreTools>[0];
	const tools = createCoreTools(options).filter((tool) => ["task_run", "task_control"].includes(tool.name));
	const subagent = createSubagentTool(
		() => {
			throw new Error("unused");
		},
		() => tools,
	);
	const current = JSON.parse(
		JSON.stringify(Object.fromEntries([...tools, subagent].map((tool) => [tool.name, tool.parameters]))),
	) as Schema;
	if (process.env.UPDATE_GOLDEN === "1") {
		writeFileSync(path, `${JSON.stringify(current, null, "\t")}\n`);
		execFileSync("npx", ["biome", "format", "--write", fileURLToPath(path)]);
	}
	const golden = JSON.parse(readFileSync(path, "utf8")) as Schema;
	compatible(golden, current);
});

test("subagent entry takes an action and puts every other field in options", () => {
	const subagent = createSubagentTool(
		() => {
			throw new Error("unused");
		},
		() => [],
	);
	const schema = JSON.parse(JSON.stringify(subagent.parameters)) as Schema;
	expect(schema.required).toEqual(["action"]);
	expect(Object.keys(schema.properties as Schema)).toEqual(["action", "options"]);
	expect(JSON.stringify(schema)).toContain('"const":"stop"');
});
