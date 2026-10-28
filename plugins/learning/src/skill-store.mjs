import { randomUUID } from "node:crypto";
import { lstat, mkdir, readdir, realpath, rename, rm, rmdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { parseDocument } from "yaml";
import { atomicText, checkActive, digest, directory, fail, readText } from "./store.mjs";

// MIT upstream behavioral reference: tools/skill_manager_{tool,batch,guards}.py.
// Native Yonder alone discovers these skills; saved scripts are never executed.
const META = ".hermes-provenance.json";
// Provenance owner is persisted user data: skills saved before the plugin rename
// keep the legacy owner id and must stay editable and archivable.
const LEGACY_OWNER = "learning";
const ownerOf = (options) => options.pluginId ?? "learning";
const owned = (meta, options) => meta.owner === ownerOf(options) || meta.owner === LEGACY_OWNER;
const MAX = 32768,
	SUPPORT_MAX = 1024 * 1024;
const fileLimit = (relative) => (["SKILL.md", META].includes(relative.split("/").at(-1)) ? MAX : SUPPORT_MAX);
const nameCheck = (name) => {
	if (!/^hermes-learned-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name ?? "") || name.length > 64)
		fail("private_skill_name_required");
	return name;
};
const fileCheck = (path = "SKILL.md") => {
	if (
		typeof path !== "string" ||
		!path ||
		path.includes("\\") ||
		path.includes("\0") ||
		path.split("/").some((p) => !p || p === "." || p === ".." || p.startsWith("."))
	)
		fail("unsafe_support_path");
	return path;
};
const version = (text) => (text === null ? "absent" : digest(text));
const key = (name, path) => `${name}/${path}`;
export function createSkillReadMarks(reviewId) {
	if (typeof reviewId !== "string" || !reviewId) fail("review_id_required");
	return { reviewId, root: null, files: new Map() };
}
function marksFor(options) {
	const marks = options.readMarks;
	if (marks && (!(marks.files instanceof Map) || marks.reviewId !== options.review?.id))
		fail("read_marks_review_mismatch");
	return marks;
}
async function baseDirectory(root) {
	const base = await directory(root);
	if ((await realpath(dirname(root))) !== resolve(dirname(root))) fail("canonical_parent_required");
	return base;
}
async function exists(path) {
	try {
		return await lstat(path);
	} catch (e) {
		if (e.code === "ENOENT") return null;
		throw e;
	}
}
// Check each directory component: NOFOLLOW on the final file alone isn't enough.
async function parents(base, relative, create = false, created = []) {
	let path = base;
	for (const part of relative.split("/").slice(0, -1)) {
		path = join(path, part);
		let st = await exists(path);
		if (!st && create) {
			await mkdir(path, { mode: 0o700 });
			created.push(path);
			st = await lstat(path);
		}
		if (st && (st.isSymbolicLink() || !st.isDirectory())) fail("unsafe_skill_directory");
		if (!st) return false;
	}
	return true;
}
async function readRelative(base, relative) {
	if (!(await parents(base, relative))) return null;
	return readText(join(base, relative), fileLimit(relative), null);
}
function textCheck(text, body = false, max = MAX) {
	if (typeof text !== "string" || (body && !text.trim()) || text.includes("\0")) fail("invalid_skill_content");
	if (Buffer.byteLength(text) > max) fail("oversized_skill");
	return text;
}
function skillContent(a) {
	if (a.content !== undefined) return textCheck(a.content, true);
	if (
		typeof a.description !== "string" ||
		!a.description.trim() ||
		a.description.length > 1024 ||
		/[\r\n\0]/.test(a.description)
	)
		fail("invalid_description");
	if (typeof a.body !== "string" || !a.body.trim() || a.body.includes("\0")) fail("invalid_body");
	if (/^---(?:\r?\n|$)/.test(a.body.trimStart()))
		fail(
			"body_must_exclude_frontmatter: Use content for a complete SKILL.md, or body for Markdown without frontmatter.",
		);
	return textCheck(
		`---\nname: ${a.name}\ndescription: ${JSON.stringify(a.description)}\n---\n${a.body.trim()}\n`,
		true,
	);
}
function fullSkillCheck(content, name) {
	textCheck(content, true);
	// Validate the actual leading metadata, never a matching field in the body.
	const parts = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/.exec(content);
	if (!parts) fail("skill_frontmatter_required: Full SKILL.md with matching name and description required.");
	const doc = parseDocument(parts[1]);
	if (doc.errors.length)
		fail("invalid_skill_frontmatter: Supply valid YAML metadata; quote descriptions containing colons.");
	const meta = doc.toJS();
	if (
		!meta ||
		meta.name !== name ||
		typeof meta.description !== "string" ||
		!meta.description.trim() ||
		meta.description.length > 1024
	)
		fail("skill_frontmatter_required: Full SKILL.md with matching name and description required.");
	if (/^---(?:\r?\n|$)/.test(parts[2].trimStart()))
		fail("duplicate_skill_frontmatter: Supply exactly one leading frontmatter block, followed by Markdown.");
	return content;
}
function patchText(before, a, max = MAX) {
	const old = a.old_string ?? a.old_text,
		replacement = a.new_string ?? a.new_text;
	if (a.content !== undefined) {
		if (old !== undefined || replacement !== undefined) fail("patch_either_content_or_span");
		return textCheck(a.content, true);
	}
	if (typeof old !== "string" || !old)
		fail("old_string_required: Read the exact file and copy a unique span; do not replace the entire file.");
	if (typeof replacement !== "string") fail("new_string_required: Empty string deletes the matched text.");
	let n = 0;
	for (let i = before.indexOf(old); i !== -1; i = before.indexOf(old, i + 1)) n++;
	if (n !== 1) fail("span_not_unique: old_string must occur exactly once in the target file.");
	return textCheck(
		before.replace(old, () => replacement),
		false,
		max,
	);
}
function fresh(options, name, path, initial) {
	if (options.review?.origin !== "background_review" || initial === null) return;
	const mark = marksFor(options)?.files.get(key(name, path));
	if (!mark || mark.revision !== version(initial))
		fail("fresh_read_required: Read this exact file in the current review before overwriting/removing it.");
}
function expectedRevision(a, options, name, path, initial) {
	const supplied =
		a.revision ??
		(options.review?.origin === "background_review"
			? marksFor(options)?.files.get(key(name, path))?.revision
			: undefined);
	if (supplied === undefined && initial === null) return; // new file requires no historical read
	if (supplied !== version(initial)) fail("conflict_stale_revision");
}
async function takeLock(base) {
	const lock = join(base, ".hermes-skill-lock");
	try {
		await mkdir(lock, { mode: 0o700 });
	} catch (e) {
		if (e.code === "EEXIST") fail("conflict_locked");
		throw e;
	}
	return lock;
}
export async function skillStore(root, a, signal, options = {}) {
	const base = await baseDirectory(root),
		readMarks = marksFor(options);
	if (readMarks) {
		if (readMarks.root !== null && readMarks.root !== base) fail("read_marks_scope_mismatch");
		readMarks.root = base;
	}
	if (a.action === "read") {
		nameCheck(a.name);
		const path = fileCheck(a.file_path),
			relative = key(a.name, path);
		await checkActive(signal, options);
		const content = await readRelative(base, relative),
			revision = version(content);
		const mark = {
			name: a.name,
			file_path: path,
			revision,
			reviewId: options.review?.id ?? null,
			readAt: new Date().toISOString(),
		};
		await checkActive(signal, options);
		marksFor(options)?.files.set(relative, mark);
		return { name: a.name, file_path: path, content, revision, readMark: mark };
	}
	if (["archive", "restore"].includes(a.action)) return transition(base, a, signal, options);
	const batch = a.operations !== undefined;
	if (batch && (!Array.isArray(a.operations) || !a.operations.length || a.operations.length > 20))
		fail("batch_requires_1_to_20_operations");
	const ops = (batch ? a.operations : [a]).map((op) => ({ ...op, name: op?.name ?? a.name }));
	const allowed = batch
		? ["create", "patch", "write_file", "remove_file"]
		: ["save", "create", "edit", "patch", "write_file", "remove_file"];
	for (const op of ops) {
		nameCheck(op.name);
		if (!allowed.includes(op.action)) fail("invalid_action: Batch allows only create/patch/write_file/remove_file.");
		fileCheck(op.file_path);
		if (["save", "create", "edit"].includes(op.action)) fullSkillCheck(skillContent(op), op.name);
		if (["write_file", "remove_file"].includes(op.action) && op.file_path === undefined) fail("file_path_required");
		if (op.action === "write_file") textCheck(op.file_content ?? op.content, false, SUPPORT_MAX);
	}
	const lock = await takeLock(base),
		initial = new Map(),
		working = new Map(),
		touched = new Set(),
		created = [];
	let snapshotDir;
	const get = async (relative) => {
		if (!initial.has(relative)) {
			const text = await readRelative(base, relative);
			initial.set(relative, text);
			working.set(relative, text);
		}
		return working.get(relative);
	};
	try {
		await checkActive(signal, options);
		// Plan every operation on an isolated snapshot before any skill mutation.
		for (const op of ops) {
			const name = op.name,
				action = op.action,
				path =
					["create", "edit", "save"].includes(action) || (op.content !== undefined && action === "patch")
						? "SKILL.md"
						: fileCheck(op.file_path),
				relative = key(name, path);
			if (["write_file", "remove_file"].includes(action) && path === "SKILL.md")
				fail("use_edit_or_patch_for_skill_body");
			if (
				(["create", "write_file", "remove_file", "save", "edit"].includes(action) || op.content !== undefined) &&
				touched.has(relative)
			)
				fail("batch_clobbers_prior_operation");
			const before = await get(relative),
				original = initial.get(relative),
				body = await get(key(name, "SKILL.md"));
			expectedRevision(op, options, name, path, original);
			if (action === "create" && body !== null) fail("skill_already_exists");
			if (["create", "save"].includes(action) && body === null && initial.get(key(name, "SKILL.md")) === null) {
				const existing = await exists(join(base, name));
				if (
					existing &&
					(!existing.isDirectory() || existing.isSymbolicLink() || (await readdir(join(base, name))).length)
				)
					fail("create_requires_empty_directory");
			}
			if (!["create", "save"].includes(action) && body === null) fail("skill_not_found");
			if (!["create", "save", "write_file"].includes(action) && before === null) fail("skill_file_not_found");
			fresh(options, name, path, original);
			let next;
			if (["create", "save", "edit"].includes(action)) next = fullSkillCheck(skillContent(op), name);
			else if (action === "patch") next = patchText(before, op, fileLimit(relative));
			else if (action === "write_file") next = textCheck(op.file_content ?? op.content, false, SUPPORT_MAX);
			else next = null;
			if (path === "SKILL.md" && next !== null) fullSkillCheck(next, name);
			working.set(relative, next);
			touched.add(relative);
			const metaKey = key(name, META),
				oldMeta = await get(metaKey);
			let meta = oldMeta
				? JSON.parse(oldMeta)
				: {
						schema: 1,
						name,
						owner: body === null ? ownerOf(options) : null,
						createdAt: new Date().toISOString(),
						createdBy: options.review?.origin ?? "foreground",
						pinned: false,
					};
			if (meta.owner !== null && !owned(meta, options)) fail("foreign_skill_ownership");
			meta = {
				...meta,
				modifiedAt: new Date().toISOString(),
				modifiedBy: options.review?.origin ?? "foreground",
				reviewId: options.review?.id ?? null,
				attended: options.review?.attended ?? true,
				modifications: (meta.modifications ?? 0) + 1,
				lastChange: { action, file_path: path, beforeRevision: version(before), afterRevision: version(next) },
			};
			const mark = marksFor(options)?.files.get(relative);
			if (mark) meta.lastUsedAt = mark.readAt;
			working.set(metaKey, JSON.stringify(meta, null, 2));
		}
		// Snapshots include metadata and exact missing/present states. Retained on
		// rollback failure; this is transactional rollback, not cross-file atomic visibility.
		snapshotDir = join(base, `.hermes-transaction-${randomUUID()}`);
		await mkdir(snapshotDir, { mode: 0o700 });
		await atomicText(join(snapshotDir, "snapshot.json"), JSON.stringify([...initial]));
		for (const [relative, text] of initial)
			if ((await readRelative(base, relative)) !== text) fail("conflict_external_change");
		if ((await directory(root)) !== base) fail("directory_changed");
		await checkActive(signal, options); // logical transaction admission, before first commit
		const written = new Map();
		try {
			for (const [relative, text] of working) {
				if (text === initial.get(relative)) continue;
				await parents(base, relative, true, created);
				// Recheck at each file, including manual edits while earlier files commit.
				if ((await readRelative(base, relative)) !== initial.get(relative)) fail("conflict_external_change");
				if (text === null) await rm(join(base, relative));
				else await atomicText(join(base, relative), text);
				written.set(relative, text);
			}
		} catch (error) {
			const failures = [];
			for (const [relative, text] of [...written].reverse()) {
				try {
					if ((await readRelative(base, relative)) !== text) fail("rollback_external_change");
					const old = initial.get(relative);
					if (old === null) await rm(join(base, relative));
					else await atomicText(join(base, relative), old);
				} catch (e) {
					failures.push({ path: relative, error: e.message });
				}
			}
			for (const path of created.reverse()) await rmdir(path).catch(() => {});
			if (failures.length) {
				error.rollbackFailed = failures;
				error.snapshot_path = snapshotDir;
				snapshotDir = null;
			}
			throw error;
		}
		const results = ops.map((op) => {
			const path =
				["create", "edit", "save"].includes(op.action) || (op.content !== undefined && op.action === "patch")
					? "SKILL.md"
					: fileCheck(op.file_path);
			return {
				name: op.name,
				action: op.action,
				file_path: path,
				revision: version(working.get(key(op.name, path))),
				path: join(base, op.name, path),
			};
		});
		// A fresh read remains valid across this review's own successful writes.
		// Advance its CAS version, not its readAt; never mint a read for a new file.
		const marks = marksFor(options);
		if (marks)
			for (const [relative, text] of working) {
				const mark = marks.files.get(relative);
				if (mark) marks.files.set(relative, { ...mark, revision: version(text) });
			}
		return { success: true, done: true, saved: true, ...(!batch ? results[0] : { results }) };
	} finally {
		// No active/signal checks here: cancellation cannot undo a committed transaction.
		if (snapshotDir) await rm(snapshotDir, { recursive: true, force: true }).catch(() => {});
		await rm(lock, { recursive: true });
	}
}
async function treeSnapshot(dir) {
	const result = [];
	async function walk(path, relative = "") {
		await directory(path);
		for (const item of (await readdir(path, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
			const rel = relative ? `${relative}/${item.name}` : item.name,
				full = join(path, item.name);
			if (item.isDirectory()) await walk(full, rel);
			else {
				if (!item.isFile()) fail("unsafe_skill_archive_entry");
				result.push([rel, await readText(full, fileLimit(rel), null)]);
			}
		}
	}
	await walk(dir);
	return JSON.stringify(result);
}
async function archiveRoot(base, create = false) {
	// Native Yonder recursively discovers even hidden directories under skills.
	// Keep archives in this private workspace, but outside its indexed skills root.
	const root = join(dirname(base), ".hermes-skill-archive");
	if (create)
		await mkdir(root, { mode: 0o700 }).catch((e) => {
			if (e.code !== "EEXIST") throw e;
		});
	await directory(root);
	return root;
}
function archiveID(id) {
	if (!/^hermes-learned-[a-z0-9-]+--[a-f0-9-]{36}$/.test(id ?? "")) fail("invalid_archive_id");
	return id;
}
export async function listSkillArchives(root) {
	let base;
	try {
		base = await archiveRoot(await baseDirectory(root));
	} catch (e) {
		if (e.code === "ENOENT") return [];
		throw e;
	}
	return (await readdir(base)).filter((id) => /^hermes-learned-[a-z0-9-]+--[a-f0-9-]{36}$/.test(id)).sort();
}
async function transition(base, a, signal, options) {
	nameCheck(a.name);
	const lock = await takeLock(base);
	try {
		await checkActive(signal, options);
		const archive = await archiveRoot(base, true),
			isRestore = a.action === "restore";
		const id = isRestore ? archiveID(a.archive_id) : `${a.name}--${randomUUID()}`;
		if (isRestore && !id.startsWith(`${a.name}--`)) fail("archive_name_mismatch");
		const from = isRestore ? join(archive, id) : join(base, a.name),
			to = isRestore ? join(base, a.name) : join(archive, id);
		const st = await exists(to);
		if (st) fail("archive_destination_exists");
		const snap = await treeSnapshot(from),
			metaRaw = await readText(join(from, META), MAX, null),
			body = await readText(join(from, "SKILL.md"), MAX, null);
		const meta = metaRaw ? JSON.parse(metaRaw) : null;
		if (!meta || !owned(meta, options) || meta.name !== a.name) fail("archive_requires_owned_skill");
		if (meta.pinned) fail("pinned_skill");
		if (a.revision !== version(body)) fail("conflict_stale_revision");
		fresh(options, a.name, "SKILL.md", body);
		if ((await treeSnapshot(from)) !== snap) fail("conflict_external_change");
		await checkActive(signal, options);
		await rename(from, to);
		return {
			success: true,
			done: true,
			saved: true,
			archived: !isRestore,
			restored: isRestore,
			archive_id: id,
			name: a.name,
			revision: version(body),
			path: to,
		};
	} finally {
		await rm(lock, { recursive: true });
	}
}
