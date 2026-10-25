import assert from "node:assert/strict";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "vitest";
import { runtimeProfile } from "../src/recipe.mjs";
import { ctx, fixture, registered, scope } from "./helpers.mjs";

const name = "hermes-learned-verify";
test("bounded real save/read/update, user conflict, names/size/symlink/abort protection", async (t) => {
	const dir = await fixture(t),
		skillDir = join(dir, "skills");
	const p = await registered("hermes-experience", { scopes: [scope(dir, { learning: true, skillDir })] });
	const tool = p.tools.find((t) => t.name.endsWith("_skill_store"));
	const call = async (a) => {
		const r = await tool.execute({ name, ...a }, ctx());
		return { ...JSON.parse(r.text), isError: r.isError };
	};
	assert.equal((await call({ action: "read" })).revision, "absent");
	const save = {
		action: "save",
		revision: "absent",
		description: "Verify bounded fixture",
		body: "# Method\nTest actual result.",
	};
	const saved = await call(save);
	assert.equal(saved.saved, true);
	const read = await call({ action: "read" });
	assert.match(read.content, /name: hermes-learned-verify/);
	assert.equal((await call(save)).error, "conflict_stale_revision");
	await writeFile(join(skillDir, name, "SKILL.md"), "user correction");
	assert.equal((await call({ ...save, revision: read.revision })).error, "conflict_stale_revision");
	assert.equal(await readFile(join(skillDir, name, "SKILL.md"), "utf8"), "user correction");
	const user = await call({ action: "read" });
	assert.equal((await call({ ...save, revision: user.revision })).saved, true);
	for (const n of ["../escape", "skill-creator", "hermes-yonder"])
		assert.equal((await call({ ...save, name: n })).error, "private_skill_name_required");
	assert.equal((await call({ ...save, body: "x".repeat(32768) })).error, "oversized_skill");
	await mkdir(join(skillDir, "hermes-learned-link"));
	await symlink(join(skillDir, name, "SKILL.md"), join(skillDir, "hermes-learned-link/SKILL.md"));
	assert.ok((await call({ action: "read", name: "hermes-learned-link" })).isError);
	const c = ctx();
	c.signal = AbortSignal.abort();
	assert.ok((await tool.execute(save, c)).isError);
	for (const c of [ctx("beta"), ctx(null), ctx("alpha", "other")]) assert.ok((await tool.execute(save, c)).isError);
});
test("conditional actual rendered contribution and native recipe on/off", async (t) => {
	const dir = await fixture(t);
	for (const enabled of [true, false])
		for (const learning of [true, false]) {
			const p = await registered("hermes-experience", {
				enabled,
				scopes: [scope(dir, { learning, skillDir: join(dir, "skills"), memory: false, user: false })],
			});
			const core = p.contexts.find((c) => c.id === "hermes-core");
			const text = await core.render(ctx());
			if (!enabled) {
				assert.equal(text, undefined);
				continue;
			}
			assert.match(text, /Finishing the job/);
			assert.doesNotMatch(text, /Enabled targets|memory_edit/);
			assert.equal(text.includes("hermes-experience_skill_store"), learning);
		}
	const p = runtimeProfile(true, false);
	assert.ok(!p.tools.offer.includes("hermes-experience_skill_store"));
	assert.deepEqual(p.skills, ["hermes-yonder"]);
	const off = runtimeProfile(false);
	assert.deepEqual(off.contexts, []);
	assert.deepEqual(off.skills, []);
	assert.ok(!off.tools.offer.includes("skill_view"));
});

test("legacy frontmatter misuse is repairable; full-content metadata is single, valid and scoped", async (t) => {
	const dir = await fixture(t),
		skillDir = join(dir, "skills");
	const p = await registered("hermes-experience", { scopes: [scope(dir, { learning: true, skillDir })] });
	const tool = p.tools.find((t) => t.name.endsWith("_skill_store"));
	const call = async (a) => JSON.parse((await tool.execute({ name, ...a }, ctx())).text);
	// Reproduces real review's legacy description + full SKILL.md in body. The
	// unquoted colon in the nested description also made that inner YAML invalid.
	const description = "HTTP parser: classify full tokens";
	const legacyBody = `---\nname: ${name}\ndescription: ${description}\n---\n# Method\nValidate the whole token.\n`;
	const bad = { action: "save", revision: "absent", description, body: legacyBody };
	assert.match((await call(bad)).error, /body_must_exclude_frontmatter/);
	assert.equal((await call({ action: "read" })).revision, "absent");
	// Ordinary legacy save is unchanged; JSON quoting produces valid metadata.
	assert.equal((await call({ ...bad, body: "# Method\nValidate the whole token." })).saved, true);
	const initial = await call({ action: "read" });
	assert.equal(initial.content.match(/^---$/gm).length, 2);
	const full = `---\nname: ${name}\ndescription: "${description}"\n---\n# Method\nValidate the whole token.\n`;
	for (const action of ["save", "create", "edit"]) {
		assert.match((await call({ ...bad, action, revision: initial.revision })).error, /body_must_exclude_frontmatter/);
		assert.match(
			(
				await call({
					action,
					name,
					revision: initial.revision,
					content: full.slice(0, full.indexOf("# Method")) + legacyBody,
				})
			).error,
			/skill_frontmatter/,
		);
	}
	for (const content of [
		full.replace('"HTTP parser: classify full tokens"', description),
		full.replace(`name: ${name}`, `name: ${name}\nname: ${name}`),
		full.replace(`name: ${name}`, "name: other"),
		full.replace('description: "HTTP parser: classify full tokens"', "other: value"),
	]) {
		assert.ok((await call({ action: "edit", revision: initial.revision, content })).error);
	}
	// Patches cannot introduce a second header. Failed batches cannot leave a
	// support file behind or change the existing exact body/revision.
	assert.match(
		(await call({ action: "patch", revision: initial.revision, old_string: "# Method", new_string: legacyBody })).error,
		/duplicate_skill_frontmatter/,
	);
	assert.match(
		(
			await call({
				operations: [
					{ action: "write_file", name, file_path: "references/no-partial.md", file_content: "must not persist" },
					{ ...bad, action: "create", name: "hermes-learned-new" },
				],
			})
		).error,
		/body_must_exclude_frontmatter/,
	);
	assert.equal((await call({ action: "read", file_path: "references/no-partial.md" })).content, null);
	assert.deepEqual((await call({ action: "read" })).content, initial.content);
	assert.equal((await call({ action: "edit", revision: initial.revision, content: full })).saved, true);
	assert.equal((await call({ action: "read" })).content, full);
});
