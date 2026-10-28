// Synthetic fixtures only. No model, session scheduler or production data.

import assert from "node:assert/strict";
import { mkdir, readdir, readFile, stat, symlink, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { test } from "vitest";
import { createSkillReadMarks, listSkillArchives, skillStore } from "../src/skill-store.mjs";
import {
	applyMemoryPending,
	DELIMITER,
	discardMemoryPending,
	editMemory,
	listMemoryPending,
	readMemory,
	readMemoryPending,
} from "../src/store.mjs";
import { fixture } from "./helpers.mjs";

const review = { id: "review-one", origin: "background_review", attended: false };
const n = "hermes-learned-testing",
	n2 = "hermes-learned-second";
const create = (name = n) => ({
	action: "create",
	name,
	description: "Synthetic test method",
	body: "# Method\nVerify before saving.",
});
const bg = (id = "review-one") => ({ review: { ...review, id }, readMarks: createSkillReadMarks(id) });
async function memory(t, raw = "one") {
	const dir = join(await fixture(t), "memories");
	await writeFile(join(dir, "MEMORY.md"), raw);
	return dir;
}
const edit = async (dir, a, limit = 2200, options = {}) =>
	editMemory(
		dir,
		{ target: "memory", revision: (await readMemory(dir, "memory")).revision, ...a },
		limit,
		undefined,
		options,
	);
const readSkill = (dir, name = n, path) => skillStore(dir, { action: "read", name, file_path: path });

test("memory BOM/dedup are logical; duplicate add preserves exact bytes and revision", async (t) => {
	const raw = `\ufeff one ${DELIMITER}two${DELIMITER}one`,
		dir = await memory(t, raw),
		before = await readMemory(dir, "memory");
	assert.deepEqual(before.entries, ["one", "two"]);
	assert.equal(before.used, 9);
	const saved = await edit(dir, { action: "add", content: " one " }, 2200, { compactResult: true });
	assert.equal(saved.noop, true);
	assert.equal(saved.saved, true);
	assert.equal(saved.done, true);
	assert.ok(!("entries" in saved));
	assert.equal(saved.revision, before.revision);
	assert.equal(await readFile(join(dir, "MEMORY.md"), "utf8"), raw);
	await edit(dir, { action: "add", content: "three" });
	assert.equal(await readFile(join(dir, "MEMORY.md"), "utf8"), `one${DELIMITER}two${DELIMITER}three`);
});
test("memory exact entry beats substring; typography fallback removes whole entry", async (t) => {
	const dir = await memory(t, `test${DELIMITER}all tests pass${DELIMITER}“Curly” — text\n wrapped`);
	await edit(dir, { action: "remove", old_text: "test" });
	assert.deepEqual((await readMemory(dir, "memory")).entries, ["all tests pass", "“Curly” — text\n wrapped"]);
	await edit(dir, { action: "remove", old_text: '"Curly" - text\\n wrapped' });
	assert.deepEqual((await readMemory(dir, "memory")).entries, ["all tests pass"]);
});
test("memory patch keeps whitespace, literal $, rejects overlapping spans and folded guesses", async (t) => {
	const dir = await memory(t, "drink tea  now\n  later");
	await edit(dir, { action: "patch", old_text: "tea ", content: "coffee $& " });
	assert.equal(await readFile(join(dir, "MEMORY.md"), "utf8"), "drink coffee $&  now\n  later");
	await writeFile(join(dir, "MEMORY.md"), "1000");
	await assert.rejects(edit(dir, { action: "patch", old_text: "00", content: "1" }), /span_not_unique/);
	await writeFile(join(dir, "MEMORY.md"), "“word”");
	await assert.rejects(edit(dir, { action: "patch", old_text: '"word"', content: "other" }), /patch_no_change/);
});
test("memory batch checks final Unicode budget, aliases content, no partial write on bad later op", async (t) => {
	const dir = await memory(t, "12345");
	const result = await edit(
		dir,
		{
			operations: [
				{ action: "add", new_text: "😀😀" },
				{ action: "remove", old_text: "12345" },
			],
		},
		5,
	);
	assert.equal(result.used, 2);
	const before = await readFile(join(dir, "MEMORY.md"), "utf8");
	await assert.rejects(
		edit(dir, {
			operations: [
				{ action: "add", content: "ok" },
				{ action: "remove", old_text: "absent" },
			],
		}),
		/no_match/,
	);
	assert.equal(await readFile(join(dir, "MEMORY.md"), "utf8"), before);
	await assert.rejects(
		edit(
			dir,
			{
				operations: [
					{ action: "remove", old_text: "😀" },
					{ action: "add", content: "too long" },
				],
			},
			5,
		),
		/budget_exceeded/,
	);
	assert.equal(await readFile(join(dir, "MEMORY.md"), "utf8"), before);
});
test("memory batch cannot clear nonempty store, single remove may; ambiguous errors are informative", async (t) => {
	const dir = await memory(t, `one shared${DELIMITER}two shared`);
	await assert.rejects(
		edit(dir, { action: "remove", old_text: "shared" }),
		(e) => /match_not_unique/.test(e.message) && e.matches.length === 2,
	);
	await assert.rejects(
		edit(dir, {
			operations: [
				{ action: "remove", old_text: "one shared" },
				{ action: "remove", old_text: "two shared" },
			],
		}),
		/batch_would_empty/,
	);
	await edit(dir, { action: "remove", old_text: "one shared" });
	await edit(dir, { action: "remove", old_text: "two shared" });
	assert.deepEqual((await readMemory(dir, "memory")).entries, []);
});
test("memory consolidation counters are caller turn-local, reset by success, terminal after 3 failures", async (t) => {
	const dir = await memory(t),
		turnState = { consolidationFailures: 0 },
		options = { turnState };
	for (let i = 1; i <= 4; i++)
		await assert.rejects(edit(dir, { action: "add", content: "xx" }, 1, options), (e) =>
			i < 4 ? /budget_exceeded/.test(e.message) && !e.done : /retry_cap/.test(e.message) && e.done,
		);
	const other = { consolidationFailures: 0 };
	await assert.rejects(edit(dir, { action: "add", content: "xx" }, 1, { turnState: other }), /budget_exceeded/);
	assert.equal(other.consolidationFailures, 1);
	assert.equal(turnState.consolidationFailures, 4);
	await edit(dir, { action: "add", content: "one" }, 1, options);
	assert.equal(turnState.consolidationFailures, 0);
});
test("unattended add saves; destructive batch stages full version and targets, then applies", async (t) => {
	const dir = await memory(t, "one"),
		options = { review, compactResult: true };
	assert.equal((await edit(dir, { action: "add", content: "two" }, 2200, options)).saved, true);
	const staged = await edit(
		dir,
		{
			operations: [
				{ action: "patch", old_text: "one", content: "first" },
				{ action: "add", content: "three" },
			],
		},
		2200,
		options,
	);
	assert.equal(staged.saved, false);
	assert.equal(staged.staged, true);
	assert.equal(staged.done, true);
	assert.deepEqual((await readMemory(dir, "memory")).entries, ["one", "two"]);
	const [pending] = await listMemoryPending(dir);
	assert.equal(pending.id, staged.pending_id);
	assert.equal(pending.operations[0].matched_entry, "one");
	assert.equal((await readMemoryPending(dir, pending.id)).revision, (await readMemory(dir, "memory")).revision);
	const applied = await applyMemoryPending(dir, pending.id, undefined, { compactResult: true });
	assert.equal(applied.saved, true);
	assert.equal(applied.pendingCleared, true);
	assert.deepEqual(await listMemoryPending(dir), []);
	assert.deepEqual((await readMemory(dir, "memory")).entries, ["first", "two", "three"]);
});
test("pending version drift refuses (even additive), remains readable/discardable; single final remove applies", async (t) => {
	const dir = await memory(t, "one"),
		options = { review };
	const p = await edit(dir, { action: "remove", old_text: "one" }, 2200, options);
	await edit(dir, { action: "add", content: "new foreground fact" });
	await assert.rejects(applyMemoryPending(dir, p.pending_id), /stale_revision/);
	assert.equal((await listMemoryPending(dir)).length, 1);
	assert.equal((await discardMemoryPending(dir, p.pending_id)).discarded, true);
	await writeFile(join(dir, "MEMORY.md"), "one");
	const last = await edit(dir, { action: "remove", old_text: "one" }, 2200, options);
	await applyMemoryPending(dir, last.pending_id);
	assert.deepEqual((await readMemory(dir, "memory")).entries, []);
});
test("attended and foreground destructive changes save directly; model review fields do not stage", async (t) => {
	const dir = await memory(t, "one");
	assert.equal((await edit(dir, { action: "patch", old_text: "one", content: "two", review }, 2200)).saved, true);
	assert.equal(
		(await edit(dir, { action: "remove", old_text: "two" }, 2200, { review: { ...review, attended: true } })).saved,
		true,
	);
	assert.deepEqual(await listMemoryPending(dir), []);
});
test("memory failed staging never saves; isActive revocation blocks final commit and staging", async (t) => {
	const dir = await memory(t, "one");
	await writeFile(join(dir, ".hermes-pending"), "not a directory");
	await assert.rejects(edit(dir, { action: "remove", old_text: "one" }, 2200, { review }));
	assert.equal(await readFile(join(dir, "MEMORY.md"), "utf8"), "one");
	let checks = 0;
	await assert.rejects(
		edit(dir, { action: "add", content: "two" }, 2200, { isActive: () => ++checks < 2 }),
		/review_inactive/,
	);
	assert.equal(await readFile(join(dir, "MEMORY.md"), "utf8"), "one");
	assert.ok(!(await readdir(dir)).some((x) => x.endsWith("yonder-lock") || x.startsWith(".hermes-write-")));
});
test("memory cancellation after commit admission does not report rolled back success", async (t) => {
	const dir = await memory(t),
		controller = new AbortController();
	let checks = 0;
	// Abort queued after final callback returns: commit has been admitted.
	const saved = await editMemory(
		dir,
		{ target: "memory", action: "add", content: "two", revision: (await readMemory(dir, "memory")).revision },
		2200,
		controller.signal,
		{
			isActive: () => {
				if (++checks === 2) setImmediate(() => controller.abort());
				return true;
			},
		},
	);
	assert.equal(saved.saved, true);
	assert.deepEqual((await readMemory(dir, "memory")).entries, ["one", "two"]);
});

test("skills create/edit/patch/read support files and provenance, scripts are only text", async (t) => {
	const root = join(await fixture(t), "skills");
	const made = await skillStore(root, create());
	assert.equal(made.saved, true);
	for (const path of ["references/api.md", "templates/output.md", "scripts/check.mjs"]) {
		await skillStore(root, {
			action: "write_file",
			name: n,
			file_path: path,
			file_content: path === "scripts/check.mjs" ? 'throw new Error("DO NOT EXECUTE");' : "old text",
		});
		let r = await readSkill(root, n, path);
		assert.equal(r.readMark.file_path, path);
		await skillStore(root, {
			action: "patch",
			name: n,
			file_path: path,
			revision: r.revision,
			old_string: path === "scripts/check.mjs" ? "DO NOT EXECUTE" : "old",
			new_string: "new",
		});
		r = await readSkill(root, n, path);
		assert.match(r.content, /new/);
		await skillStore(root, { action: "remove_file", name: n, file_path: path, revision: r.revision });
		assert.equal((await readSkill(root, n, path)).revision, "absent");
	}
	const read = await readSkill(root);
	await skillStore(root, {
		action: "edit",
		name: n,
		revision: read.revision,
		content: read.content.replace("Verify before saving.", "Read actual evidence."),
	});
	const meta = JSON.parse(await readFile(join(root, n, ".hermes-provenance.json"), "utf8"));
	assert.equal(meta.owner, "learning");
	assert.equal(meta.createdBy, "foreground");
	assert.ok(meta.modifications >= 11);
	assert.equal((await stat(join(root, n, "SKILL.md"))).mode & 0o777, 0o600);
});
test("skills background overwrite needs current review exact-file fresh read, not history revision", async (t) => {
	const root = join(await fixture(t), "skills");
	await skillStore(root, create());
	const prior = await readSkill(root),
		options = bg();
	await assert.rejects(
		skillStore(
			root,
			{ action: "patch", name: n, revision: prior.revision, old_string: "Verify", new_string: "Check" },
			undefined,
			options,
		),
		/fresh_read_required/,
	);
	await skillStore(root, { action: "read", name: n }, undefined, options);
	const changed = await skillStore(
		root,
		{ action: "patch", name: n, old_string: "Verify", new_string: "Check" },
		undefined,
		options,
	);
	assert.equal(changed.saved, true);
	const ownNext = await skillStore(
		root,
		{ action: "edit", name: n, content: prior.content, revision: changed.revision },
		undefined,
		options,
	);
	assert.equal(ownNext.saved, true); // this review's own writes don't require another read
	const newReview = bg("review-two");
	await assert.rejects(
		skillStore(
			root,
			{ action: "patch", name: n, revision: ownNext.revision, old_string: "Verify", new_string: "Check" },
			undefined,
			newReview,
		),
		/fresh_read_required/,
	);
	await assert.rejects(
		skillStore(root, { action: "read", name: n }, undefined, { ...newReview, readMarks: options.readMarks }),
		/read_marks_review_mismatch/,
	);
});
test("skill support-file fresh read cannot be substituted by reading SKILL.md; new files need no read", async (t) => {
	const root = join(await fixture(t), "skills"),
		options = bg();
	await skillStore(root, create(), undefined, options);
	await skillStore(
		root,
		{ action: "write_file", name: n, file_path: "references/a.md", file_content: "old" },
		undefined,
		options,
	);
	const prior = await readSkill(root, n, "references/a.md");
	await skillStore(root, { action: "read", name: n }, undefined, options);
	await assert.rejects(
		skillStore(
			root,
			{ action: "write_file", name: n, file_path: "references/a.md", file_content: "new", revision: prior.revision },
			undefined,
			options,
		),
		/fresh_read_required/,
	);
	await skillStore(root, { action: "read", name: n, file_path: "references/a.md" }, undefined, options);
	await skillStore(
		root,
		{ action: "write_file", name: n, file_path: "references/a.md", file_content: "new" },
		undefined,
		options,
	);
	const meta = JSON.parse(await readFile(join(root, n, ".hermes-provenance.json"), "utf8"));
	assert.equal(meta.modifiedBy, "background_review");
	assert.equal(meta.attended, false);
	assert.ok(meta.lastUsedAt);
});
test("skills stale revisions and concurrent human edit preserve user bytes", async (t) => {
	const root = join(await fixture(t), "skills"),
		options = bg();
	await skillStore(root, create());
	const prior = await skillStore(root, { action: "read", name: n }, undefined, options);
	await writeFile(join(root, n, "SKILL.md"), prior.content.replace("Verify", "Human verifies"));
	await assert.rejects(
		skillStore(
			root,
			{ action: "patch", name: n, revision: prior.revision, old_string: "Verify", new_string: "Check" },
			undefined,
			options,
		),
		/conflict_stale_revision/,
	);
	assert.match((await readSkill(root)).content, /Human verifies/);
	let checks = 0;
	const now = await readSkill(root);
	await assert.rejects(
		skillStore(
			root,
			{ action: "patch", name: n, revision: now.revision, old_string: "Human verifies", new_string: "Check" },
			undefined,
			{
				isActive: async () => {
					if (++checks === 2) await writeFile(join(root, n, "SKILL.md"), "human update during planning");
					return true;
				},
			},
		),
		/conflict_external_change/,
	);
	assert.equal((await readSkill(root)).content, "human update during planning");
});
test("skill batch final planning validates all ops, chains patches and rolls back real mid-commit IO failure", async (t) => {
	const root = join(await fixture(t), "skills");
	await assert.rejects(
		skillStore(root, { operations: [create(), { action: "write_file", name: n, file_path: "references/a.md" }] }),
		/invalid_skill_content/,
	);
	assert.equal((await readSkill(root)).revision, "absent");
	await skillStore(root, {
		operations: [
			create(),
			{ action: "patch", name: n, revision: "absent", old_string: "Verify", new_string: "Check" },
			{ action: "write_file", name: n, file_path: "references/a.md", file_content: "details" },
			create(n2),
		],
	});
	assert.match((await readSkill(root)).content, /Check/);
	const before = await readSkill(root),
		second = await readSkill(root, n2);
	let checks = 0;
	// Real fs error after first file commit: callback replaces second target with a
	// directory, so rename/read validation fails; no mocked model or IO success.
	await assert.rejects(
		skillStore(
			root,
			{
				operations: [
					{ action: "patch", name: n, revision: before.revision, old_string: "Check", new_string: "Changed" },
					{ action: "write_file", name: n2, file_path: "references/block.md", file_content: "new" },
				],
			},
			undefined,
			{
				isActive: async () => {
					if (++checks === 2) await mkdir(join(root, n2, "references/block.md"), { recursive: true });
					return true;
				},
			},
		),
	);
	assert.equal((await readSkill(root)).content, before.content);
	assert.equal((await readSkill(root, n2)).revision, second.revision);
	assert.ok(!(await readdir(root)).some((x) => x.startsWith(".hermes-transaction-") || x === ".hermes-skill-lock"));
});
test("skill batch limits/actions/clobber guards, create rollback preserves preexisting empty directory", async (t) => {
	const root = join(await fixture(t), "skills");
	await assert.rejects(skillStore(root, { operations: Array.from({ length: 21 }, () => create()) }), /1_to_20/);
	await assert.rejects(skillStore(root, { operations: [{ ...create(), action: "edit" }] }), /Batch allows/);
	await assert.rejects(
		skillStore(root, { operations: [create(), { ...create(), action: "patch", content: "overwrite" }] }),
		/batch_clobbers/,
	);
	assert.equal((await readSkill(root)).revision, "absent");
	await mkdir(join(root, n));
	let checks = 0;
	await assert.rejects(
		skillStore(root, { operations: [create(), create(n2)] }, undefined, {
			isActive: async () => {
				if (++checks === 2) await mkdir(join(root, n2, "SKILL.md"), { recursive: true });
				return true;
			},
		}),
	);
	assert.deepEqual(await readdir(join(root, n)), []);
	assert.ok((await stat(join(root, n))).isDirectory());
});
test("skill path traversal, symlink parents, private names and metadata overwrite are refused", async (t) => {
	const root = join(await fixture(t), "skills");
	await skillStore(root, create());
	for (const name of ["shared", "hermes-yonder", "../escape"])
		await assert.rejects(skillStore(root, { ...create(), name }), /private_skill_name/);
	for (const file_path of [
		"../outside",
		"references/../outside",
		"/absolute",
		"a\\b",
		".hermes-provenance.json",
		"references//a",
	])
		await assert.rejects(
			skillStore(root, { action: "write_file", name: n, file_path, file_content: "bad" }),
			/unsafe_support_path/,
		);
	await symlink(root, join(root, n, "references"));
	await assert.rejects(
		skillStore(root, { action: "write_file", name: n, file_path: "references/escape", file_content: "bad" }),
		/unsafe_skill_directory/,
	);
});
test("skill precommit cancellation/invalidated review write nothing; admitted batch completes despite cancellation", async (t) => {
	const root = join(await fixture(t), "skills");
	let checks = 0;
	await assert.rejects(skillStore(root, create(), undefined, { isActive: () => ++checks < 2 }), /review_inactive/);
	assert.equal((await readSkill(root)).revision, "absent");
	await assert.rejects(skillStore(root, create(), AbortSignal.abort()));
	const controller = new AbortController();
	checks = 0;
	const result = await skillStore(root, { operations: [create(), create(n2)] }, controller.signal, {
		isActive: () => {
			if (++checks === 2) setImmediate(() => controller.abort());
			return true;
		},
	});
	assert.equal(result.saved, true);
	assert.equal(result.results.length, 2);
	assert.ok((await readSkill(root, n2)).content);
});
test("skill own unpinned archive/restore reversible; foreign, pinned and restore collision protected", async (t) => {
	const root = join(await fixture(t), "skills");
	await skillStore(root, create());
	const before = await readSkill(root);
	const archived = await skillStore(root, { action: "archive", name: n, revision: before.revision });
	assert.equal(archived.archived, true);
	assert.equal((await readSkill(root)).revision, "absent");
	assert.deepEqual(await listSkillArchives(root), [archived.archive_id]);
	assert.ok(relative(root, archived.path).startsWith("../")); // native scans hidden dirs too
	assert.ok(!(await readdir(root)).includes(n));
	assert.equal(await readFile(join(archived.path, "SKILL.md"), "utf8"), before.content);
	const restored = await skillStore(root, {
		action: "restore",
		name: n,
		revision: before.revision,
		archive_id: archived.archive_id,
	});
	assert.equal(restored.restored, true);
	assert.equal((await readSkill(root)).content, before.content);
	assert.deepEqual(await listSkillArchives(root), []);
	const metaPath = join(root, n, ".hermes-provenance.json"),
		meta = JSON.parse(await readFile(metaPath, "utf8"));
	await writeFile(metaPath, JSON.stringify({ ...meta, pinned: true }));
	await assert.rejects(skillStore(root, { action: "archive", name: n, revision: before.revision }), /pinned_skill/);
	await writeFile(metaPath, JSON.stringify({ ...meta, owner: null }));
	await assert.rejects(
		skillStore(root, { action: "archive", name: n, revision: before.revision }),
		/archive_requires_owned/,
	);
	await writeFile(metaPath, JSON.stringify(meta));
	const again = await skillStore(root, { action: "archive", name: n, revision: before.revision });
	await skillStore(root, create());
	await assert.rejects(
		skillStore(root, { action: "restore", name: n, revision: before.revision, archive_id: again.archive_id }),
		/destination_exists/,
	);
});
test("skills saved under legacy learning owner stay editable and archivable", async (t) => {
	const root = join(await fixture(t), "skills");
	await skillStore(root, create());
	const metaPath = join(root, n, ".hermes-provenance.json"),
		meta = JSON.parse(await readFile(metaPath, "utf8"));
	await writeFile(metaPath, JSON.stringify({ ...meta, owner: "learning" }));
	const read = await readSkill(root);
	await skillStore(root, {
		action: "patch",
		name: n,
		revision: read.revision,
		old_string: "Verify",
		new_string: "Check",
	});
	const after = await readSkill(root);
	assert.equal(JSON.parse(await readFile(metaPath, "utf8")).owner, "learning");
	const archived = await skillStore(root, { action: "archive", name: n, revision: after.revision });
	assert.equal(archived.archived, true);
	await writeFile(join(archived.path, ".hermes-provenance.json"), JSON.stringify({ ...meta, owner: "other" }));
	await assert.rejects(
		skillStore(root, { action: "restore", name: n, revision: after.revision, archive_id: archived.archive_id }),
		/archive_requires_owned/,
	);
});

test("support files retain up to upstream 1 MiB text, SKILL.md keeps legacy 32 KiB; nonempty orphan is not adopted", async (t) => {
	const root = join(await fixture(t), "skills");
	await skillStore(root, create());
	const content = "reference\n".repeat(5000);
	await skillStore(root, { action: "write_file", name: n, file_path: "references/large.md", file_content: content });
	assert.equal((await readSkill(root, n, "references/large.md")).content, content);
	await assert.rejects(
		skillStore(root, {
			action: "write_file",
			name: n,
			file_path: "references/oversized.md",
			file_content: "x".repeat(1024 * 1024 + 1),
		}),
		/oversized_skill/,
	);
	await mkdir(join(root, n2));
	await writeFile(join(root, n2, "foreign.txt"), "not owned");
	await assert.rejects(skillStore(root, create(n2)), /create_requires_empty/);
	assert.equal(await readFile(join(root, n2, "foreign.txt"), "utf8"), "not owned");
});
test("skill cooperative lock serializes writers; duplicate expected revision never loses a write", async (t) => {
	const root = join(await fixture(t), "skills");
	const before = await skillStore(root, create());
	const results = await Promise.allSettled(
		["one", "two"].map((new_string) =>
			skillStore(root, { action: "patch", name: n, revision: before.revision, old_string: "Verify", new_string }),
		),
	);
	assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
	assert.ok(results.find((r) => r.status === "rejected").reason.message.match(/conflict_locked|stale_revision/));
});

test("review read marks bind exact canonical skills scope, not only matching skill name", async (t) => {
	const first = join(await fixture(t), "skills"),
		second = join(await fixture(t), "skills"),
		options = bg();
	await skillStore(first, create());
	await skillStore(second, create());
	const read = await skillStore(first, { action: "read", name: n }, undefined, options);
	await assert.rejects(
		skillStore(
			second,
			{ action: "patch", name: n, revision: read.revision, old_string: "Verify", new_string: "Check" },
			undefined,
			options,
		),
		/read_marks_scope_mismatch/,
	);
	assert.match((await readSkill(second)).content, /Verify/);
});
