# Learning-store internal API

This documents the implemented storage. The learning runtime exposes these operations
through foreground and dedicated review tools, with plugin-owned session grants; see
[Learning runtime](learning-runtime.md). Installation/production selection is unchanged.
The legacy foreground read/edit/save shapes remain compatible.

Source reference: NousResearch/hermes-agent
`4dcef215cfe41bd2d02c2d1dad6e257a18101216`, MIT (NOTICE and retained license).

## Authority and trusted options

These functions take the already-authorized directory, not a ToolContext. As before,
the caller must enforce enabled flags, Agent/profile/local environment, private
workspace root and `exclusive-yonder` for memory writes **before calling storage**.
A review dispatcher must resolve its genuine `ctx.session` to an active grant and
use that grant's validated parent directories. Do not fabricate `ctx.agent`, accept
model-provided directories, or grant general task sessions write access.

The final argument is a **trusted internal object**, never tool arguments:

```js
const options = {
  review: {id: 'unique-review-id', origin: 'background_review', attended: false},
  isActive: () => grantStillMatchesSessionAndGeneration(), // boolean|Promise<boolean>
  compactResult: true,                                  // memory only
  turnState: {consolidationFailures: 0},                  // memory only, per owner turn
  readMarks: createSkillReadMarks('unique-review-id'),    // skills only
};
```

`isActive` may return false or throw to refuse; undefined is not a refusal.
`signal` is an optional AbortSignal, checked alongside active status. Memory checks
at entry and after fsync immediately before its atomic rename (or pending rename).
Skills check at entry and at transaction admission after validation/snapshot/version
checks, before the first target commit. **One batch is one admitted transaction**:
once admitted it finishes, or rolls back an IO/conflict failure. A cancellation that
arrives after admission does not turn already-committed writes into failures or undo
them. There are no global review variables or per-process retry counters.

`review.origin === 'background_review'` selects review behavior, independently of
`attended`. Attended review skill writes still require review-local reads. Foreground
calls omit `review`. Putting a `review` or `readMarks` field in a tool argument has no
effect; phase 2 must not spread model arguments into these options.

## Memory (`plugins/learning/src/store.mjs`)

Exact callable signatures (all return Promises):

```js
readMemory(dir, target, limit = LIMITS[target])
editMemory(dir, args, limit = LIMITS[args.target], signal, options = {})
listMemoryPending(dir)
readMemoryPending(dir, id)
applyMemoryPending(dir, id, signal, options = {})
discardMemoryPending(dir, id, signal, options = {})
```

`target`: `memory|user`; `LIMITS`: 2200/1375 Unicode code points. Existing signatures
and return fields are retained. Read returns `{target,revision,entries,used,limit,
overBudget}`. Exact disk bytes (including BOM) determine the SHA256 revision; logical
entries strip initial BOM, trim outer whitespace and deduplicate in original order.
Usage/budget includes serialized separators and counts Unicode code points, not tokens.

```js
// Existing single call; old_text and replacement whitespace are significant for patch.
args = {target, action: 'add'|'patch'|'remove', revision, content?, old_text?}
// New atomic batch, one target and one read revision. action may be omitted or 'batch'.
args = {target, revision, operations: [{action, content?, new_text?, old_text?}, ...]}
```

`new_text` aliases `content`. Whole-entry exact match wins over substrings; if no
literal substring exists, removal can locate a unique quote/dash/whitespace-folded
entry. Patch still requires one exact, non-overlapping-or-overlapping-counted span:
folded location is not permission to invent a splice. More than one occurrence,
including overlapping occurrences, refuses. Patch preserves the rest verbatim and
does not trim replacement whitespace. Remove removes the entire matched entry.
Empty patch replacement is refused (use a longer span to remove only some text).

Duplicate add is a successful no-op (including no physical rewrite of BOM/formatting).
A batch validates every operation, then only its final budget, under the existing
per-target cooperative lock. Nonempty stores cannot be emptied by batch; single
remove remains the explicit last-entry deletion path. Failure writes no memory bytes.

Success adds `{success:true,done:true,saved:true,noop,entry_count,note}` and the usual
snapshot fields. For old direct consumers `entries` remains by default; review/new
wrappers should pass `compactResult:true` to omit it. There is no full-store success
echo in that mode. On budget failure, thrown Error includes `current_entries,used,
limit,needed`; no-match includes current entries; ambiguous match includes `matches`.
When `turnState` is supplied, consecutive budget/no-match failures increment it,
failures 1–3 retain repair hints, and the fourth has `done:true,success:false` plus
`consolidation_retry_cap`. Success resets it. The caller creates a new object at the
owner turn boundary; do not share it between Agents/reviews. Tool wrappers should
serialize Error details (including `done`), not only `e.message`.

### Pending

Unattended background add saves directly. Any patch/remove, or a batch containing
one, validates the complete proposed result and stages a private JSON record under
`memories/.hermes-pending/<uuid>.json`, returning:

```js
{success:true,done:true,staged:true,proposal_staged:true,saved:false,pending_id,target}
```

No messages are sent. Stage failure throws, never says saved. Records include target,
exact source revision, limit, original single/batch shape and each destructive op's
full matched entry. Enumeration/read return actual full records; apply/discard are
explicit foreground management operations, not an approval required for all writes.
Attended or ordinary foreground mutations continue to save directly.

Apply reuses the same writer and **pins the entire source revision**, intentionally
stricter than upstream's matched-entry-only pin: even intervening additive edits
require recreating the proposal. A stale/error record remains intact. Success returns
the saved result plus `pending_id,pendingCleared`; if post-commit record cleanup fails,
`pendingCleared:false` does not erase the saved outcome. Discard returns
`{success:true,discarded:true,pending_id}` and never edits memory. Enumeration with no
pending directory is `[]`; missing individual records are errors.

## Skills (`plugins/learning/src/skill-store.mjs`)

Exact callable signatures:

```js
skillStore(root, args, signal, options = {})
createSkillReadMarks(reviewId) // synchronous; returns {reviewId,root:null,files:Map}
listSkillArchives(root)       // Promise<string[]> of real archive IDs
```

`root` is the authorized resident native `workspace/skills` root. Every name must
match the existing `hermes-learned-*` boundary (max 64 characters). No shared/builtin
lookup or override is added. Saved scripts are data, never automatically executed.

Argument shapes:

```js
{action:'read', name, file_path?} // default SKILL.md; missing -> revision:'absent',content:null
{action:'save', name, revision, description, body} // unchanged legacy API
{action:'create'|'edit', name, revision?, content} // full SKILL.md
// create/edit also accept the legacy description/body construction
// body = Markdown only, without frontmatter; content = complete SKILL.md
{action:'patch', name, file_path?, revision?, old_string, new_string}
// aliases old_text/new_text; empty new_string deletes a span
{action:'patch', name, revision?, content} // full SKILL.md rewrite; not combined with spans
{action:'write_file', name, file_path, revision?, file_content} // empty text is valid
{action:'remove_file', name, file_path, revision?}
{operations:[{action,name?,...},...], name?} // 1..20, name fallback
{action:'archive', name, revision}
{action:'restore', name, revision, archive_id}
```

`create` requires absence and may adopt only a preexisting empty real directory.
`save` retains its old absent/existing behavior. Edits and SKILL.md patches must keep
full frontmatter with matching name and nonempty description. Precise patch supports
exactly one span (including overlapping-count checks), not an upstream fuzzy engine.
`write_file/remove_file` cannot substitute for editing/removing `SKILL.md`.

Safe relative support paths include `references/...`, `templates/...`, `scripts/...`
and other nonhidden relative files. Absolute paths, empty/dot/dotdot components,
backslashes, NUL, hidden paths and directory symlinks are refused. SKILL.md retains
its existing 32 KiB limit; support text allows up to upstream's 1 MiB. UTF8 is strict;
final files must be regular, nonhardlinked, nonsymlink files. There is no script runner.

Existing file mutations require its exact `revision`; new files default to expected
absence. In reviews a missing explicit revision is derived from the **trusted current
review read mark**, not from historical transcript text. Read returns
`{name,file_path,content,revision,readMark}` and registers that mark in `options.readMarks`.
Marks are bound on first call to the canonical skills root and must match review ID.
Background overwrite/removal of each existing exact file requires such a mark;
reading SKILL.md does not cover a supporting file. New files/skills do not need reads.
After this review's own successful write, an existing mark advances its CAS revision
without pretending to have read again. A new file does not automatically acquire a
read mark. Other reviews get a new Map. Human edits since the marked version refuse.
Native skill_view alone cannot populate these marks yet; stage 2's review wrapper
must route reads through this function or explicitly implement a trusted equivalent.

Batch allows **only create/patch/write_file/remove_file**. Validation and planning run
against isolated per-file snapshots under one existing root-wide skill lock. An
operation that would clobber a preceding op's work refuses; precise patch chains are
allowed. Snapshot includes exact absence/presence and metadata of touched skills.
Files are fsynced/renamed individually; this promises all-or-rollback on errors, **not
cross-file atomic visibility or crash recovery**. Rollback preserves unrelated files
and preexisting empty directories. It never overwrites a detected out-of-band edit
just to restore a snapshot: errors then include `rollbackFailed` and `snapshot_path`
pointing to the retained `.hermes-transaction-*/snapshot.json` for recovery. This is
an explicit failure, not saved. Successful transactions clean their private snapshots.

Single mutation success is `{success:true,done:true,saved:true,name,action,file_path,
revision,path}`. Batch success replaces those single-op fields with `results:[...]`;
revisions describe the final version of each target. Error rejects the Promise.

`.hermes-provenance.json` records ownership, created/modified origin, review ID,
attended flag, modification count and last change before/after revisions. A trusted
review read's timestamp is recorded as lastUsedAt on its next mutation. Read-only
calls themselves do not mutate this sidecar. Existing unowned private skills may be
edited but do not acquire ownership just because they were edited. This is minimal
store-local provenance, not a global usage ledger/native scanner.

Archive/restore are sole actions, not batch members. They require recorded ownership
`learning` (or legacy `hermes-experience`, kept for skills saved before the rename) and `pinned:false`, exact body revision and a safe complete tree.
Archive atomically moves to `dirname(root)/.hermes-skill-archive/<name>--<uuid>`;
restore refuses an existing destination, preserves all files/provenance, and never
permanently deletes. This is still the private resident workspace, but **outside the
indexed skills root**: installed Yonder `createSkills`/`discover` recursively scans
hidden directories too, so an archive under skills would incorrectly remain visible.
Result includes `saved:true,archived,restored,archive_id,name,revision,path`. Background
archive also requires the exact current-review body read. No curator timer is added.

## Shared low-level exports (implementation only)

`store.mjs` also exports `DELIMITER`, `LIMITS`, `digest(raw)`,
`fail(code, details = {})`, `directory(path)`, `checkActive(signal, options = {})`,
`readText(path, max = 65536, missing = '')`, and
`atomicText(path, text, beforeCommit = async () => {})` for skill-store reuse.
They are not tool entrypoints or scope checks. Trusted parent directories must not
be maliciously swapped; no filesystem sandbox, OS CAS or parallel upstream Hermes
flock compatibility is claimed. Existing exclusive-Yonder ownership remains required.

## Evidence

`node --check` on both store modules and `npm test` exercise synthetic files and actual
filesystem errors, original SDK registration/scope tests, final-budget memory batches,
pending/version pinning, support files, read marks, conflict, rollback, cancellation,
archive/restore and size/ownership guards. These store regressions make no model calls, service restarts or
production-home writes. Native controlled-kernel acceptance is a separate check.

### Frontmatter validation (0.1.1)

Legacy description/body remains supported. A body beginning with frontmatter is
refused with `body_must_exclude_frontmatter` and an actionable repair hint; use
`content` for a complete document instead. Full create/save/edit and SKILL.md
patches validate the leading block as YAML, require matching name/nonempty string
description, and reject a second leading frontmatter block. No silently stripped
metadata and no fixture migration. Validation failures preserve exact disk bytes
and CAS revisions, including failed batches. YAML 2.9.1 is reused from the main workspace’s existing dependency graph;
the official package declares that exact existing dependency for runtime validation.
