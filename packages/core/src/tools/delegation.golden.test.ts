import { readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "vitest";
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
	const current = JSON.parse(
		JSON.stringify(Object.fromEntries(tools.map((tool) => [tool.name, tool.parameters]))),
	) as Schema;
	if (process.env.UPDATE_GOLDEN === "1") writeFileSync(path, `${JSON.stringify(current, null, "\t")}\n`);
	const golden = JSON.parse(readFileSync(path, "utf8")) as Schema;
	compatible(golden, current);
});
