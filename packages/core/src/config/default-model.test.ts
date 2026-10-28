import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { initHome } from "../kernel/home.js";
import { loadYonderConfig, parseYonderConfig, presetProfile, resolveProfile } from "./index.js";

const yaml = (extra: string) => `schema: 1\n${extra}agents:\n  - { id: main, workspace: ./agents/main }\n`;

test("model-less presets resolve to the configured default model", () => {
	const config = parseYonderConfig(yaml("defaultModel: provider-x/model-y\n"), "yonder.yaml");
	expect(resolveProfile({}, {}, "local", config.defaultModel).model).toBe("provider-x/model-y");
	expect(presetProfile({}, "local", undefined, undefined, undefined, config.defaultModel).model).toBe(
		"provider-x/model-y",
	);
	// A model set on the profile or the agent defaults still wins.
	expect(resolveProfile({ model: "a/b" }, {}, "local", config.defaultModel).model).toBe("a/b");
	expect(resolveProfile({}, { model: "c/d" }, "local", config.defaultModel).model).toBe("c/d");
});

test("a home with no model anywhere fails naming defaultModel", () => {
	expect(() => resolveProfile({})).toThrow("defaultModel");
	expect(() => resolveProfile({})).toThrow("未配置默认模型");
	// Not needing a default: the profile already names its model.
	expect(resolveProfile({ model: "a/b" }).model).toBe("a/b");
});

test("an existing home without defaultModel keeps the model it resolved before the field existed", () => {
	const legacy = parseYonderConfig(yaml(""), "yonder.yaml");
	expect(legacy.defaultModel).toBe("openai/gpt-6-luna");
	expect(presetProfile({}, "local", undefined, undefined, undefined, legacy.defaultModel).model).toBe(
		"openai/gpt-6-luna",
	);
	// A home that registers no agent has no history to preserve.
	expect(parseYonderConfig("schema: 1\n", "yonder.yaml").defaultModel).toBeUndefined();
});

test("init writes the chosen model and refuses to create a home without one", async () => {
	const home = await mkdtemp("/tmp/yonder-default-model-");
	try {
		await expect(initHome(join(home, "none"))).rejects.toThrow("defaultModel");
		await initHome(join(home, "set"), "owner", { model: "provider-x/model-y" });
		expect((await loadYonderConfig(join(home, "set"))).defaultModel).toBe("provider-x/model-y");
	} finally {
		await rm(home, { recursive: true, force: true });
	}
});
