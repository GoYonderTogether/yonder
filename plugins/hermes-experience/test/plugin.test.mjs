import assert from "node:assert/strict";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { test } from "vitest";
import { ctx, fixture, registered, scope } from "./helpers.mjs";

test("real SDK manifest contract; registered tool persists and new session render loads", async (t) => {
	const root = await fixture(t),
		config = { scopes: [scope(root)] };
	const p = await registered("hermes-experience", config);
	const [read, edit] = p.tools,
		context = p.contexts[0];
	const before = await context.render(ctx());
	const m = JSON.parse((await read.execute({ target: "memory" }, ctx())).text);
	const written = await edit.execute(
		{ target: "memory", action: "add", revision: m.revision, content: "NEW_SESSION_SENTINEL" },
		ctx(),
	);
	assert.ok(!written.isError, written.text);
	const fresh = await registered("hermes-experience", config);
	assert.match(await fresh.contexts[0].render(ctx("alpha", "owner", "2")), /NEW_SESSION_SENTINEL/);
	assert.doesNotMatch(before, /NEW_SESSION_SENTINEL/);
	assert.match(await readFile(join(root, "memories/MEMORY.md"), "utf8"), /NEW_SESSION_SENTINEL/);
});
test("cross-Agent/profile/task denial; no caller-chosen memory directory", async (t) => {
	const root = await fixture(t),
		p = await registered("hermes-experience", { scopes: [scope(root)] });
	for (const c of [ctx("beta"), ctx("alpha", "stranger"), ctx(null)]) {
		const r = await p.tools[0].execute({ target: "memory" }, c);
		assert.ok(r.isError);
		assert.match(r.text, /scope_denied/);
		assert.equal(await p.contexts[0].render(c), undefined);
	}
	await assert.rejects(
		registered("hermes-experience", { scopes: [scope(root), scope(root, { agent: "beta" })] }),
		/duplicate_scope/,
	);
});
test("disabled module and both target switches touch no filesystem and return no prompts", async () => {
	for (const config of [
		{ enabled: false, scopes: [scope(resolve("/nonexistent"))] },
		{ scopes: [scope(resolve("/nonexistent"), { memory: false, user: false })] },
	]) {
		const p = await registered("hermes-experience", config);
		assert.equal(await p.contexts[0].render(ctx()), undefined);
		for (const tool of p.tools.slice(0, 2)) {
			const r = await tool.execute({ target: "memory" }, ctx());
			assert.ok(r.isError);
			assert.match(r.text, /disabled/);
		}
	}
});
test("readonly default, user target switch, overbudget prompt refusal", async (t) => {
	const root = await fixture(t),
		p = await registered("hermes-experience", { scopes: [scope(root, { writeMode: "readonly", user: false })] });
	assert.match((await p.tools[1].execute({ target: "memory", action: "add" }, ctx())).text, /readonly_scope/);
	assert.match((await p.tools[0].execute({ target: "user" }, ctx())).text, /target_disabled/);
	await writeFile(join(root, "memories/MEMORY.md"), "x".repeat(2201));
	await assert.rejects(p.contexts[0].render(ctx()), /over_budget/);
});
test("canonical aliases cannot share another Agent memory store", async (t) => {
	const root = await fixture(t);
	await mkdir(join(root, "alias"));
	await symlink(join(root, "memories"), join(root, "alias/memories"));
	const p = await registered("hermes-experience", {
		scopes: [scope(root), scope(join(root, "alias"), { agent: "beta" })],
	});
	assert.ok((await p.tools[0].execute({ target: "memory" }, ctx())).isError);
});
// Invalid targets must be denied BEFORE even resolving a configured path.
// The ToolContext env is the host ExecutionEnv (no id field): scope dirs are host paths, so no env.id gate exists.
test("invalid target refuses before filesystem access", async () => {
	const p = await registered("hermes-experience", { scopes: [scope(resolve("/nonexistent"))] });
	for (const tool of p.tools.slice(0, 2))
		assert.match((await tool.execute({ target: "other" }, ctx())).text, /invalid_target/);
});

test("fresh-per-render snapshot refreshes same session, deletion/new session/setup; old strings immutable", async (t) => {
	const root = await fixture(t),
		config = { scopes: [scope(root)] },
		p = await registered("hermes-experience", config);
	const c = ctx("alpha", "owner", "stable-session");
	const before = await p.contexts[0].render(c);
	const read = async () => JSON.parse((await p.tools[0].execute({ target: "memory" }, c)).text);
	let m = await read();
	assert.ok(
		!(await p.tools[1].execute({ target: "memory", action: "add", revision: m.revision, content: "SNAPSHOT_FACT" }, c))
			.isError,
	);
	const after = await p.contexts[0].render(c);
	assert.match(after, /SNAPSHOT_FACT/);
	assert.doesNotMatch(before, /SNAPSHOT_FACT/);
	m = await read();
	assert.ok(
		!(
			await p.tools[1].execute(
				{ target: "memory", action: "remove", revision: m.revision, old_text: "SNAPSHOT_FACT" },
				c,
			)
		).isError,
	);
	assert.match(after, /SNAPSHOT_FACT/);
	assert.doesNotMatch(await p.contexts[0].render(c), /SNAPSHOT_FACT/);
	const fresh = await registered("hermes-experience", config);
	assert.doesNotMatch(await fresh.contexts[0].render(ctx("alpha", "owner", "new-session")), /SNAPSHOT_FACT/);
	const off = await registered("hermes-experience", { ...config, enabled: false });
	for (const context of off.contexts) assert.equal(await context.render(c), undefined);
	assert.match(await p.contexts.find((c) => c.id === "hermes-behavior").render(c), /not the upstream Python/);
	assert.equal(await p.contexts.find((c) => c.id === "hermes-behavior").render(ctx("beta")), undefined);
	assert.equal(p.presets[0].model, "openai/gpt-6.1-sol");
	assert.equal(p.presets[0].thinking, "medium");
	assert.deepEqual(p.presets[0].contexts, []);
});
