import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolContext } from "@yonder/sdk";
import { afterAll, expect, test } from "vitest";
import { FileCredentials } from "../runtime/credentials.js";
import { type ModelProfile, modelProfile } from "../runtime/model-profile.js";
import { buildModels } from "../runtime/models.js";
import { coreToolCapabilities } from "./catalog.js";
import { createCoreTools } from "./index.js";
import { createModelRouteTool, modelChainRefs, routeModel } from "./model-route.js";

// Real offline catalog entries; only selection metadata is varied to exercise ordering.
const home = mkdtempSync(join(tmpdir(), "yonder-model-route-"));
afterAll(() => rmSync(home, { recursive: true, force: true }));
const profiles = buildModels(new FileCredentials(join(home, "auth.json")))
	.getModels()
	.slice(0, 3)
	.map(modelProfile) as [ModelProfile, ModelProfile, ModelProfile];
const [first, second, third] = profiles.map((profile) => profile.id);
const ranked = () => {
	const entries = structuredClone(profiles);
	entries.forEach((entry, index) => {
		entry.cost.input = index + 1;
		entry.cost.output = index + 1;
		entry.scores.intelligence.overall = (index + 1) / 3;
	});
	return entries;
};

test("intelligence leads planning, design, execution and review; chores favor cost", () => {
	const entries = ranked();
	for (const taskType of ["plan", "design", "execute", "review"]) {
		const result = routeModel(entries, { taskType });
		expect(result.model).toBe(third);
		expect(result.alternatives.map((entry) => entry.model)).toEqual([second, first]);
	}
	expect(routeModel(entries, { taskType: "chore" }).model).toBe(first);
});

test("task-specific score and preference override overall intelligence", () => {
	const entries = ranked();
	entries[0].scores.intelligence.byTask.plan = 1;
	expect(routeModel(entries, { taskType: "plan" }).model).toBe(first);
	entries[1].scores.preference.byTask.plan = 0.8;
	expect(routeModel(entries, { taskType: "plan" }).model).toBe(second);
});

test("prefer and avoid precede ranking but cannot bypass hard constraints", () => {
	const entries = ranked();
	entries[0].pins.prefer = ["plan"];
	expect(routeModel(entries, { taskType: "plan" }).model).toBe(first);
	entries[0].pins.avoid = ["plan"];
	expect(routeModel(entries, { taskType: "plan", prefer: [first] }).model).toBe(third);
	entries[1].aliases = ["preferred"];
	expect(routeModel(entries, { taskType: "plan", prefer: ["preferred"] }).model).toBe(second);
	entries[1].catalog.contextWindow = null;
	expect(routeModel(entries, { taskType: "plan", prefer: ["preferred"], needContext: 1 }).model).toBe(third);
});

test("unknown measurements are not free, intelligent or tool-capable", () => {
	const entries = ranked();
	entries[0].cost.input = null;
	entries[2].scores.intelligence.overall = null;
	expect(routeModel(entries, { taskType: "chore" }).model).toBe(second);
	expect(routeModel(entries, { taskType: "plan" }).model).toBe(second);
	expect(routeModel(entries, { taskType: "execute", needTools: true }).model).toBeNull();
	entries[1].catalog.toolCall = true;
	expect(routeModel(entries, { taskType: "execute", needTools: true }).model).toBe(second);
});

test("context, image and budget constraints exclude unknown or insufficient data", () => {
	const entries = ranked();
	entries.forEach((entry) => {
		entry.catalog.input = [];
		entry.catalog.contextWindow = 100;
	});
	entries[1].catalog.input = ["text", "image"];
	entries[1].catalog.contextWindow = 200;
	expect(routeModel(entries, { taskType: "plan", needImages: true, needContext: 200 }).model).toBe(second);
	expect(routeModel(entries, { taskType: "plan", needContext: 201 }).model).toBeNull();
	expect(routeModel(entries, { taskType: "plan", budgetUsd: 1 }).model).toBeNull();
	entries[1].local = { ...entries[1].local, samples: 5, avgCost: 0.1 };
	expect(routeModel(entries, { taskType: "plan", budgetUsd: 0.1 }).model).toBe(second);
	expect(routeModel(entries, { taskType: "plan", budgetUsd: 0.09 }).model).toBeNull();
});

test("empty catalog, stable ties, immutable input and reproducible catalog hash", () => {
	expect(routeModel([], { taskType: "plan" }).model).toBeNull();
	const before = structuredClone(profiles);
	const result = routeModel(profiles, { taskType: "plan" });
	expect(profiles).toEqual(before);
	expect(result.catalogHash).toMatch(/^[a-f0-9]{64}$/);
	expect(routeModel(profiles, { taskType: "chore" }).catalogHash).toBe(result.catalogHash);
	before[0].notes = "changed";
	expect(routeModel(before, { taskType: "plan" }).catalogHash).not.toBe(result.catalogHash);
	const tied = ranked();
	tied.forEach((entry) => {
		entry.cost.input = 1;
		entry.cost.output = 1;
		entry.scores.intelligence.overall = null;
	});
	expect(routeModel(tied, { taskType: "plan" }).model).toBe(first);
});

test.each([
	{ taskType: "unknown" },
	{ taskType: "plan", needContext: -1 },
	{ taskType: "plan", budgetUsd: -1 },
	{ taskType: "plan", needImages: "yes" },
])("rejects invalid input %j", (input) => {
	expect(() => routeModel(profiles, input)).toThrow("Invalid model_route input");
});

test("registered tool requires read and only returns recommendations", async () => {
	const context = { capabilities: ["read"], signal: new AbortController().signal } as ToolContext;
	const tool = createModelRouteTool(async () => profiles);
	expect(tool.capabilities).toEqual(["read"]);
	const result = await tool.execute({ taskType: "plan" }, context);
	expect(result.isError).toBeUndefined();
	expect(JSON.parse(result.text).reason).toContain("recommendation only");
	expect((await tool.execute({ taskType: "plan" }, { ...context, capabilities: [] })).isError).toBe(true);
	expect((await tool.execute({ taskType: "unknown" }, context)).isError).toBe(true);
	// Registration inspection does not execute runtime/store operations.
	const registered = createCoreTools({} as Parameters<typeof createCoreTools>[0]);
	expect(registered.find((entry) => entry.name === "model_route")?.capabilities).toEqual(["read"]);
	expect(coreToolCapabilities.model_route).toEqual(["read"]);
});

test("models.chain expands to configured provider/model refs only", () => {
	const providers = {
		// A bare provider entry means its first configured model.
		workbuddy: { models: [{ id: "deepseek-v4.1-flash" }, { id: "other" }] },
		"rightapi-glm": { models: ["glm-5.3-flash"] },
		// A configured provider without a model list has nothing to fall back to.
		empty: {},
	};
	// Unconfigured providers drop out (S2): a home without them keeps its single model.
	expect(modelChainRefs(["workbuddy", "rightapi-glm/glm-5.3-flash", "siliconflow", "openai"], providers)).toEqual([
		"workbuddy/deepseek-v4.1-flash",
		"rightapi-glm/glm-5.3-flash",
	]);
	// The primary model is where the run already starts, and a repeated entry never burns twice.
	expect(
		modelChainRefs(["workbuddy", "workbuddy/deepseek-v4.1-flash"], providers, "workbuddy/deepseek-v4.1-flash"),
	).toEqual([]);
	expect(modelChainRefs(["empty"], providers)).toEqual([]);
	expect(modelChainRefs(["workbuddy"], undefined)).toEqual([]);
	expect(modelChainRefs([], providers)).toEqual([]);
});
