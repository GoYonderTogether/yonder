import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, realpath, rename, rmdir, unlink } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";

// Behavior adapted from NousResearch/hermes-agent (MIT), see NOTICE.
export const DELIMITER = "\n§\n";
export const LIMITS = { memory: 2200, user: 1375 };
export const digest = (raw) => createHash("sha256").update(raw).digest("hex");
const count = (raw) => [...raw].length;
export function fail(code, details = {}) {
	throw Object.assign(new Error(code), details);
}
export async function directory(path) {
	if (!isAbsolute(path) || resolve(path) !== path) fail("absolute_normalized_directory_required");
	const canonical = await realpath(path),
		st = await lstat(path);
	if (st.isSymbolicLink() || !st.isDirectory()) fail("unsafe_directory");
	return canonical;
}
// Trusted internal callbacks only; never accept these options from tool arguments.
export async function checkActive(signal, options = {}) {
	signal?.throwIfAborted();
	if (options.isActive && (await options.isActive()) === false) fail("review_inactive");
	signal?.throwIfAborted();
}
export async function readText(path, max = 65536, missing = "") {
	let file;
	try {
		// Windows ignores O_NOFOLLOW; verify the opened file still matches a non-link path.
		const before = process.platform === "win32" ? await lstat(path) : null;
		if (before?.isSymbolicLink()) fail("unsafe_or_oversized_memory_file");
		file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
		const st = await file.stat();
		if (before) {
			const after = await lstat(path);
			if (
				after.isSymbolicLink() ||
				before.dev !== st.dev ||
				before.ino !== st.ino ||
				after.dev !== st.dev ||
				after.ino !== st.ino
			)
				fail("unsafe_or_oversized_memory_file");
		}
		if (!st.isFile() || st.nlink !== 1 || st.size > max) fail("unsafe_or_oversized_memory_file");
		const bytes = await file.readFile();
		if (bytes.length > max) fail("oversized_memory_file");
		return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
	} catch (e) {
		if (e.code === "ENOENT") return missing;
		throw e;
	} finally {
		await file?.close();
	}
}
// beforeCommit is deliberately after the temp is fsynced. No cancellation check
// after rename: a committed write stays committed even if its caller is cancelled.
export async function atomicText(path, text, beforeCommit = async () => {}) {
	const tmp = join(dirname(path), `.hermes-write-${randomUUID()}`);
	try {
		const out = await open(tmp, "wx", 0o600);
		try {
			await out.writeFile(text, "utf8");
			await out.sync();
		} finally {
			await out.close();
		}
		await beforeCommit();
		await rename(tmp, path);
	} finally {
		await unlink(tmp).catch((e) => {
			if (e.code !== "ENOENT") throw e;
		});
	}
}
const filename = (target) =>
	target === "memory" ? "MEMORY.md" : target === "user" ? "USER.md" : fail("invalid_target");
const parse = (raw) => [
	...new Set(
		raw
			.replace(/^\ufeff/, "")
			.split(DELIMITER)
			.map((e) => e.trim())
			.filter(Boolean),
	),
];
function snapshot(raw, target, limit) {
	const entries = parse(raw),
		used = count(entries.join(DELIMITER));
	return { target, revision: digest(raw), entries, used, limit, overBudget: used > limit };
}
export async function readMemory(dir, target, limit = LIMITS[target]) {
	return snapshot(await readText(join(await directory(dir), filename(target))), target, limit);
}
const normalize = (s) =>
	s
		.replace(/\\n/g, " ")
		.replace(/["`‘’‚‛“”„‟]/g, "'")
		.replace(/[‐‑‒–—―−]/g, "-")
		.replace(/\s+/gu, " ")
		.trim();
function locate(entries, text) {
	let matches = entries.map((e, i) => (e === text ? i : -1)).filter((i) => i >= 0);
	if (!matches.length) matches = entries.map((e, i) => (e.includes(text) ? i : -1)).filter((i) => i >= 0);
	if (!matches.length && /[\p{L}\p{N}]/u.test(normalize(text)))
		matches = entries.map((e, i) => (normalize(e).includes(normalize(text)) ? i : -1)).filter((i) => i >= 0);
	if (matches.length > 1)
		fail("match_not_unique: Multiple distinct entries matched; copy a longer span from one entry.", {
			matches: matches.map((i) => entries[i]),
		});
	if (!matches.length)
		fail("no_match: Copy old_text verbatim from ONE entry; use one operation per entry.", { current_entries: entries });
	return matches[0];
}
function apply(entries, op) {
	if (!op || !["add", "patch", "remove"].includes(op.action)) fail("invalid_action: Use add, patch or remove.");
	const content = op.content ?? op.new_text;
	if (
		op.action !== "remove" &&
		(typeof content !== "string" || !content.trim() || content.includes(DELIMITER) || content.includes("\0"))
	)
		fail("invalid_content: Nonempty content without entry delimiter or NUL required.");
	if (op.action === "add") {
		if (!entries.includes(content.trim())) entries.push(content.trim());
		return null;
	}
	if (typeof op.old_text !== "string" || !op.old_text.trim()) fail("old_text_required");
	const needle = op.action === "patch" ? op.old_text : op.old_text.trim(),
		i = locate(entries, needle),
		before = entries[i];
	if (op.action === "remove") entries.splice(i, 1);
	else {
		let n = 0;
		for (let p = before.indexOf(needle); p !== -1; p = before.indexOf(needle, p + 1)) n++;
		if (n > 1) fail("span_not_unique: Include more surrounding text so old_text occurs once.");
		// Typography folding locates an entry, not a span. Like upstream, never guess
		// how to splice a normalized substring back into the original layout.
		if (!n || needle === content)
			fail("patch_no_change: Copy the exact span including whitespace; patch must change it.");
		entries[i] = before.replace(needle, () => content);
	}
	return before;
}
function success(raw, target, limit, options, noop = false) {
	const m = snapshot(raw, target, limit);
	if (options.compactResult) delete m.entries; // legacy direct consumers retain entries
	return {
		...m,
		success: true,
		done: true,
		saved: true,
		noop,
		entry_count: parse(raw).length,
		note: noop
			? "Entry already exists; no duplicate added."
			: "Write saved. This update is complete — do not repeat it.",
	};
}
export async function editMemory(dir, args, limit = LIMITS[args.target], signal, options = {}) {
	const { target, revision } = args;
	if (!/^[a-f0-9]{64}$/.test(revision ?? "")) fail("revision_required_read_first");
	const batch = args.operations !== undefined,
		ops = batch ? args.operations : [args];
	if (!Array.isArray(ops) || !ops.length) fail("operations_required_nonempty");
	if (batch && args.action && args.action !== "batch") fail("action_operations_conflict");
	if (ops.some((op) => op?.target !== undefined && op.target !== target)) fail("batch_target_mismatch");
	const root = await directory(dir),
		path = join(root, filename(target)),
		lock = `${path}.yonder-lock`;
	try {
		await mkdir(lock, { mode: 0o700 });
	} catch (e) {
		if (e.code === "EEXIST") fail("conflict_locked");
		throw e;
	}
	try {
		await checkActive(signal, options);
		const raw = await readText(path);
		if (digest(raw) !== revision) fail("conflict_stale_revision");
		const before = parse(raw),
			working = [...before],
			pinned = [];
		for (const op of ops) pinned.push(apply(working, op));
		if (!batch && args.action === "add" && working.length === before.length) {
			await checkActive(signal, options);
			if (options.turnState) options.turnState.consolidationFailures = 0;
			return success(raw, target, limit, options, true);
		}
		if (batch && before.length && !working.length)
			fail("batch_would_empty: Use a single remove to deliberately delete the last entry.");
		const next = working.join(DELIMITER),
			used = count(next);
		if (used > limit)
			fail(
				"budget_exceeded: Shorten/remove old entries AND add new content in ONE operations batch; only final budget is checked.",
				{ current_entries: before, used, limit, needed: used - limit },
			);
		const review = options.review;
		if (review?.origin === "background_review" && review.attended !== true && ops.some((op) => op.action !== "add")) {
			const pendingRoot = await pendingDirectory(root, true),
				id = randomUUID();
			const record = {
				id,
				target,
				revision,
				limit,
				batch,
				operations: ops.map((op, i) => ({
					action: op.action,
					content: op.content ?? op.new_text,
					old_text: op.old_text,
					matched_entry: pinned[i],
				})),
				createdAt: new Date().toISOString(),
				review: { id: review.id ?? null, origin: review.origin, attended: false },
			};
			const pendingText = JSON.stringify(record, null, 2);
			if (Buffer.byteLength(pendingText) > 262144)
				fail("pending_record_oversized: Split the proposal into smaller independently reviewed changes.");
			await atomicText(join(pendingRoot, `${id}.json`), pendingText, async () => {
				if (digest(await readText(path)) !== revision) fail("conflict_external_change");
				if ((await directory(dir)) !== root) fail("directory_changed");
				await checkActive(signal, options);
			});
			if (options.turnState) options.turnState.consolidationFailures = 0;
			return { success: true, done: true, staged: true, proposal_staged: true, saved: false, pending_id: id, target };
		}
		// Duplicate add is a true no-op, including on BOM/hand-formatted files.
		const noop = ops.every((op) => op.action === "add") && working.length === before.length;
		if (!noop)
			await atomicText(path, next, async () => {
				if (digest(await readText(path)) !== revision) fail("conflict_external_change");
				if ((await directory(dir)) !== root) fail("directory_changed");
				await checkActive(signal, options);
			});
		else await checkActive(signal, options);
		if (options.turnState) options.turnState.consolidationFailures = 0;
		return success(noop ? raw : next, target, limit, options, noop);
	} catch (e) {
		if (options.turnState && /^(budget_exceeded|no_match)/.test(e.message)) {
			options.turnState.consolidationFailures = (options.turnState.consolidationFailures ?? 0) + 1;
			const n = options.turnState.consolidationFailures;
			if (n > 3) {
				e.done = true;
				e.message = "consolidation_retry_cap: Stop memory retries this turn and continue the user reply.";
			}
			e.success = false;
		}
		throw e;
	} finally {
		await rmdir(lock);
	}
}
async function pendingDirectory(root, create = false) {
	const p = join(root, ".hermes-pending");
	if (create)
		await mkdir(p, { mode: 0o700 }).catch((e) => {
			if (e.code !== "EEXIST") throw e;
		});
	await directory(p);
	return p;
}
function pendingID(id) {
	if (!/^[a-f0-9-]{36}$/.test(id ?? "")) fail("invalid_pending_id");
	return `${id}.json`;
}
export async function readMemoryPending(dir, id) {
	const p = join(await pendingDirectory(await directory(dir)), pendingID(id)),
		raw = await readText(p, 262144, null);
	if (raw === null) fail("pending_not_found");
	return JSON.parse(raw);
}
export async function listMemoryPending(dir) {
	let root;
	try {
		root = await pendingDirectory(await directory(dir));
	} catch (e) {
		if (e.code === "ENOENT") return [];
		throw e;
	}
	const records = [];
	for (const file of (await readdir(root)).sort())
		if (/^[a-f0-9-]{36}\.json$/.test(file)) records.push(await readMemoryPending(dir, file.slice(0, -5)));
	return records;
}
export async function discardMemoryPending(dir, id, signal, options = {}) {
	const root = await pendingDirectory(await directory(dir)),
		file = join(root, pendingID(id));
	await checkActive(signal, options);
	await unlink(file);
	return { success: true, discarded: true, pending_id: id };
}
export async function applyMemoryPending(dir, id, signal, options = {}) {
	const record = await readMemoryPending(dir, id);
	// Full-file revision is deliberately stricter than upstream's per-entry pin:
	// no approved proposal may silently absorb intervening foreground changes.
	const payload = record.batch ? { operations: record.operations } : record.operations[0];
	const result = await editMemory(
		dir,
		{ ...payload, target: record.target, revision: record.revision },
		record.limit,
		signal,
		{ ...options, review: undefined },
	);
	// Cancellation after a successful commit must not turn saved into a failure.
	let pendingCleared = true;
	try {
		await unlink(join(await pendingDirectory(await directory(dir)), pendingID(id)));
	} catch {
		pendingCleared = false;
	}
	return { ...result, pending_id: id, pendingCleared };
}
