import type { Harness, ToolExecutionResult } from "@earendil-works/pi-durable";
import type { PermissionsAPI, Tool } from "@yonder/sdk";
import { expect, test } from "vitest";
import type { DeliveryService } from "../delivery/index.js";
import { createBackground } from "../runtime/background.js";
import type { Runtime } from "../runtime/index.js";
import type { Sessions } from "../sessions/index.js";
import type { Skills } from "../skills/index.js";
import type { Store } from "../store/index.js";
import { coreToolCapabilities } from "./catalog.js";
import { createCoreTools } from "./index.js";
import { createPermissionsTool } from "./permissions.js";
import { createSkillTool } from "./skill-view.js";

// Schema inspection only: these stubs never execute a tool, so no store, model or permission provider is needed.
function coreTools(): Tool[] {
	return [
		...createCoreTools({
			store: {} as Store,
			agents: new Map(),
			sessions: {} as Sessions,
			runtime: () => ({}) as Runtime,
			delivery: {} as DeliveryService,
			ask: async () => {
				throw new Error("Schema inspection does not ask");
			},
			getPreset: () => undefined,
		}),
		createPermissionsTool({} as PermissionsAPI),
		createSkillTool({} as Skills, async () => {
			throw new Error("Schema inspection does not resolve a session");
		}),
		// The process tool is registered by Runtime (runtime/index.ts), not by createCoreTools; only its schema is read here.
		createBackground({
			harness: () => ({}) as Harness,
			config: async () => "",
			execute: async () => ({}) as ToolExecutionResult,
			finished: async () => {},
			report: () => {},
		}).tool as unknown as Tool,
	];
}

test("every core tool declares a top-level object parameter schema", () => {
	const tools = coreTools();
	// Guard against the list drifting: every registered core tool is inspected, none is silently missing.
	expect(tools.map((tool) => tool.name).sort()).toEqual(Object.keys(coreToolCapabilities).sort());
	for (const tool of tools) {
		const parameters = tool.parameters as { type?: unknown; anyOf?: unknown; oneOf?: unknown };
		// Strict provider APIs reject a root union: DeepSeek reports `Invalid schema for function 'permissions' ... got 'type: null'`.
		expect({ tool: tool.name, type: parameters.type }).toEqual({ tool: tool.name, type: "object" });
		expect({ tool: tool.name, anyOf: parameters.anyOf, oneOf: parameters.oneOf }).toEqual({
			tool: tool.name,
			anyOf: undefined,
			oneOf: undefined,
		});
	}
});
