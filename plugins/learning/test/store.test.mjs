import assert from "node:assert/strict";
import { mkdir, readdir, readFile, stat, symlink, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "vitest";
import { DELIMITER, editMemory, readMemory } from "../src/store.mjs";
import { fixture } from "./helpers.mjs";

test("add/patch/remove retain original files, Unicode budget and revision", async (t) => {
	const home = await fixture(t),
		dir = join(home, "memories");
	let m = await readMemory(dir, "memory");
	m = await editMemory(dir, { target: "memory", action: "add", revision: m.revision, content: "😀 test" });
	assert.equal(m.used, [...`synthetic note${DELIMITER}😀 test`].length);
	m = await editMemory(dir, {
		target: "memory",
		action: "patch",
		revision: m.revision,
		old_text: "note",
		content: "fact",
	});
	assert.deepEqual(m.entries, ["synthetic fact", "😀 test"]);
	m = await editMemory(dir, { target: "memory", action: "remove", revision: m.revision, old_text: "😀" });
	assert.equal(await readFile(join(dir, "MEMORY.md"), "utf8"), "synthetic fact");
	// Windows does not expose POSIX permission bits.
	if (process.platform !== "win32") assert.equal((await stat(join(dir, "MEMORY.md"))).mode & 0o777, 0o600);
	assert.deepEqual((await readdir(dir)).sort(), ["MEMORY.md", "USER.md"]);
});
test("budget failure, ambiguous matches, stale revisions and locks preserve bytes", async (t) => {
	const dir = join(await fixture(t), "memories"),
		m = await readMemory(dir, "memory");
	await assert.rejects(
		editMemory(dir, { target: "memory", action: "add", revision: m.revision, content: "x".repeat(2201) }),
		/budget_exceeded/,
	);
	assert.equal(await readFile(join(dir, "MEMORY.md"), "utf8"), "synthetic note");
	await writeFile(join(dir, "MEMORY.md"), `one common${DELIMITER}two common`);
	await assert.rejects(
		editMemory(dir, { target: "memory", action: "remove", revision: m.revision, old_text: "note" }),
		/stale_revision/,
	);
	const n = await readMemory(dir, "memory");
	await assert.rejects(
		editMemory(dir, { target: "memory", action: "remove", revision: n.revision, old_text: "common" }),
		/match_not_unique/,
	);
	await mkdir(join(dir, "MEMORY.md.yonder-lock"));
	await assert.rejects(
		editMemory(dir, { target: "memory", action: "add", revision: n.revision, content: "new" }),
		/conflict_locked/,
	);
});
test("two competing writers only one commits; no lost update", async (t) => {
	const dir = join(await fixture(t), "memories"),
		m = await readMemory(dir, "memory");
	const outcomes = await Promise.allSettled(
		["A", "B"].map((content) => editMemory(dir, { target: "memory", action: "add", revision: m.revision, content })),
	);
	assert.equal(outcomes.filter((o) => o.status === "fulfilled").length, 1);
	assert.equal((await readMemory(dir, "memory")).entries.length, 2);
});
test("malformed UTF8, symlink, nonregular and oversize refuse", async (t) => {
	const dir = join(await fixture(t), "memories"),
		file = join(dir, "MEMORY.md");
	await writeFile(file, Buffer.from([255]));
	await assert.rejects(readMemory(dir, "memory"));
	await unlink(file);
	await symlink(join(dir, "USER.md"), file);
	await assert.rejects(readMemory(dir, "memory"));
	await unlink(file);
	await mkdir(file);
	await assert.rejects(readMemory(dir, "memory"));
	await writeFile(join(dir, "USER.md"), "x".repeat(65537));
	await assert.rejects(readMemory(dir, "user"), /oversized/);
});
test("cancellation cleans cooperative lock and does not write", async (t) => {
	const dir = join(await fixture(t), "memories"),
		m = await readMemory(dir, "memory");
	const c = new AbortController();
	c.abort();
	await assert.rejects(
		editMemory(dir, { target: "memory", action: "add", revision: m.revision, content: "cancelled" }, 2200, c.signal),
	);
	assert.deepEqual((await readdir(dir)).sort(), ["MEMORY.md", "USER.md"]);
	assert.equal((await readMemory(dir, "memory")).revision, m.revision);
});

test("UTF8 BOM is included in exact-byte revision", async (t) => {
	const root = await fixture(t),
		dir = join(root, "memories");
	await writeFile(join(dir, "MEMORY.md"), "\ufeffsame");
	const before = await readMemory(dir, "memory");
	await writeFile(join(dir, "MEMORY.md"), "same");
	const after = await readMemory(dir, "memory");
	assert.notEqual(before.revision, after.revision);
	await assert.rejects(
		editMemory(dir, { target: "memory", action: "add", content: "x", revision: before.revision }),
		/stale_revision/,
	);
});
