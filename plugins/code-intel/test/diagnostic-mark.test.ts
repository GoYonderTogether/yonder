import { createRegistrationCollector } from "@yonder/sdk/testing";
import { expect, test } from "vitest";
import { resolveProfile } from "../../../packages/core/src/config/test-support.js";
import { inspectToolCatalog } from "../../../packages/core/src/runtime/catalog.js";
import plugin from "../src/index.js";

test("diagnostic mark registration is additive and absent when the plugin is not selected", async () => {
	const { api, registrations } = createRegistrationCollector();
	await plugin.setup(api as never);
	const tool = registrations.tools.find((t) => t.name === "code-intel_lens_diagnostic_mark");
	if (!tool) throw new Error("diagnostic mark missing");
	expect(tool.capabilities).toEqual(["read", "write", "exec"]);
	expect(tool.parameters.required).toEqual(["filePath", "line", "message", "disposition"]);
	const descriptor = JSON.stringify({ name: tool.name, description: tool.description, parameters: tool.parameters });
	console.log("DIAGNOSTIC_MARK_DESCRIPTOR_BYTES", Buffer.byteLength(descriptor));
	const catalog = inspectToolCatalog(
		{
			agent: null,
			profile: "test",
			cwd: process.cwd(),
			resolved: resolveProfile({
				plugins: [],
				capabilities: ["read", "write", "exec"],
				tools: { offer: [tool.name], search: [] },
			}),
		},
		new Map([["code-intel", registrations.tools as never]]),
	);
	expect(catalog.find((item) => item.name === tool.name)?.exposure).toBe("plugin-not-selected");
});
