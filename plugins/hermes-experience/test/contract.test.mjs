import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { checkPlugin } from "@yonder/sdk/testing";
import { test } from "vitest";
import { ctx, registered } from "./helpers.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
test("official dist manifest satisfies the SDK contract without implicit scope", async () => {
	assert.deepEqual(await checkPlugin(root), []);
	const p = await registered("hermes-experience", {});
	assert.match((await p.tools[0].execute({ target: "memory" }, ctx())).text, /scope_denied/);
	for (const c of p.contexts) assert.equal(await c.render(ctx()), undefined);
});
test("official package follows release version/dependencies and includes all runtime assets", async () => {
	const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
	const harness = JSON.parse(await readFile(new URL("../../../package.json", import.meta.url), "utf8"));
	assert.equal(pkg.name, "@yonder/plugin-hermes-experience");
	assert.equal(pkg.version, harness.version);
	assert.equal(pkg.dependencies["@yonder/sdk"], harness.version);
	assert.equal(pkg.dependencies.yaml, "2.9.1");
	assert.equal(pkg.yonder.entry, "./dist/index.mjs");
	for (const file of [
		"dist/index.mjs",
		"dist/review.mjs",
		"dist/recipe.mjs",
		"assets/behavior.md",
		"assets/Hermes-MIT.txt",
		"skills/hermes-yonder/SKILL.md",
		"NOTICE",
	])
		assert.ok((await readFile(new URL(`../${file}`, import.meta.url))).length, file);
	assert.ok(harness.workspaces.includes("plugins/hermes-experience"));
});
