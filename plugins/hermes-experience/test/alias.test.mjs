import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { checkPlugin, checkRegistrations, createRegistrationCollector, readPluginManifest } from "@yonder/sdk/testing";
import { test } from "vitest";
import * as learningRecipe from "../../learning/src/recipe.mjs";
import * as recipe from "../src/recipe.mjs";

const root = resolve("plugins/hermes-experience"),
	learningRoot = resolve("plugins/learning");

test("deprecated alias keeps legacy id, tools and contributions and logs a deprecation warning", async () => {
	assert.deepEqual(await checkPlugin(root), []);
	const manifest = await readPluginManifest(root),
		learning = await readPluginManifest(learningRoot);
	assert.equal(manifest.id, "hermes-experience");
	assert.deepEqual(
		manifest.contributes.tools,
		learning.contributes.tools.map((t) => t.replace(/^learning_/, "hermes-experience_")),
	);
	assert.deepEqual({ ...manifest.contributes, tools: [] }, { ...learning.contributes, tools: [] });
	const c = createRegistrationCollector(),
		warnings = [];
	const module = await import(join(root, "src/index.mjs"));
	await module.default.setup({
		...c.api,
		id: "hermes-experience",
		config: { scopes: [] },
		log: { info() {}, error() {}, warn: (message) => warnings.push(message) },
	});
	assert.deepEqual(await checkRegistrations(manifest, c.registrations, root), []);
	assert.equal(warnings.length, 1);
	assert.equal(warnings[0], "hermes-experience 已弃用，请改用 learning；将在 0.5 移除");
	assert.ok(c.registrations.presets.every((p) => p.plugins.includes("hermes-experience")));
});

test("alias recipe and bundled skill stay in sync with plugin-learning", async () => {
	assert.equal(recipe.recipeId, learningRecipe.recipeId);
	assert.deepEqual(recipe.runtimeProfile(), learningRecipe.runtimeProfile(true, true, "hermes-experience"));
	assert.deepEqual(recipe.registration("owner").profile.plugins, ["hermes-experience"]);
	const skill = (dir) => readFile(join(dir, "skills/hermes-yonder/SKILL.md"), "utf8");
	assert.equal(await skill(root), (await skill(learningRoot)).replaceAll("learning_", "hermes-experience_"));
});

test("alias official package contract", async () => {
	const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8")),
		harness = JSON.parse(await readFile("package.json", "utf8"));
	assert.equal(pkg.name, "@yonder/plugin-hermes-experience");
	assert.equal(pkg.deprecated, true);
	assert.equal(pkg.version, harness.version);
	assert.equal(pkg.dependencies["@yonder/plugin-learning"], harness.version);
	assert.ok(harness.workspaces.includes("plugins/hermes-experience"));
	assert.ok(harness.workspaces.indexOf("plugins/learning") < harness.workspaces.indexOf("plugins/hermes-experience"));
});
