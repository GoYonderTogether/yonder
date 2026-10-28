import type { ToolContext } from "@yonder/sdk";
import { createRegistrationCollector } from "@yonder/sdk/testing";
import { expect, test } from "vitest";
import plugin from "../src/index.js";

test("diagnostics exposes selectors and does not claim an empty session cache is clean", async () => {
	const { api, registrations } = createRegistrationCollector();
	await plugin.setup(api as never);
	const tool = registrations.tools.find((item) => item.name === "code-intel_lens_diagnostics");
	if (!tool) throw new Error("missing diagnostics");
	expect(tool.capabilities).toEqual(["read", "exec"]);
	expect(Object.keys(tool.parameters.properties ?? {})).toEqual(
		expect.arrayContaining(["source", "scope", "paths", "path", "severity", "mode"]),
	);
	for (const args of [{ source: "session" }, {}, { paths: ["file.c"] }]) {
		const result = await tool.execute(args, {} as ToolContext);
		expect(result.isError).toBe(true);
		expect(result.text).toContain("unavailable");
	}
});
