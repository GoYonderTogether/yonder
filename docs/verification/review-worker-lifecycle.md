# Fix round: worker lifecycle and committed cloud inputs

本页保留当时的命令、原始计数、失败原因与真实短摘录；原始日志与机器转储已按最终清理要求移除。

2026-11-03. Only the two authorized worktrees were changed. No push, deploy, production access, or model-key output.

## Implemented behavior

- Worker activation uses the existing per-Bot input queue and a reserved `ready` entry. Opening one Bot no longer holds a global activation promise. Closing entries retain their slot until close completes, preserving the cap of 20 across concurrent eviction/acquisition.
- A Bot is eligible for release after 60 seconds without a source-message lease or real runtime activity. The existing single scheduler checks this every 15 seconds. Deterministic plugin scans do not renew idle usage. Runtime and trigger work still protect the instance from eviction.
- Runtime eviction reads one native aggregate inspection, plus current finish/recovery/background notification work, instead of listing sessions and querying each one.
- The outbound queue schedules only real, unfinalized notification intents. An empty queue does not wake an inactive Bot every minute; enqueue and remaining digest/quiet work preserve their deadlines.
- Server turns expire after five minutes even while the worker socket remains online. One shared five-second scan writes through the existing locked result slot; a late reply receives the already recorded error instead of adding a second result.
- A user message already committed to PG returns HTTP 200 even if subsequent dispatch/error writing fails. The pending result can recover through the deadline scan. The client receives the committed message identity and has no HTTP 500 reason to duplicate it.
- Worker DM creation now requires the same real owner predicate as workBridge: human and not anonymous.

## Executed checks

| Check | Result | Output excerpt |
|---|---|---|
| Cloud focused bots + realtime, real PG/Redis | 34 passed / 0 failed / 0 cancelled / 0 skipped | 34/0 result above; see Cloud readable verification record |
| Native SQLite runtime busy regression | 4 passed / 0 failed / 0 skipped | `摘录：Test Files  1 passed (1) / Tests  4 passed (4)` |
| Outbound, owner notifications and runtime activity | 11 passed / 0 failed / 0 skipped, four files | `摘录：Test Files  4 passed (4) / Tests  11 passed (11)` |
| Targeted adapter/bot-core/cloud build, attempts 4 and 5 | exit 0 | No stdout; exit codes above. |
| Real lifecycle: PG/Redis/server/worker and loopback model transport | exit 0; isolated slow activation does not block another tenant; 2 active instances release after **73,680 ms**, below LRU capacity; released Bot reopens successfully; 3 completed sources / 0 pending | `"pendingSources": 0` |
| Final size gate | exit 0; 656 files / baseline 0 | `摘录：✓ 通过：0 个文件在基线内且未增长` |

Runnable lifecycle check: `node scripts/cloud-worker/lifecycle.mjs` after building both repositories. It holds one Bot's definition insertion behind a real PG advisory lock, waits for the other tenant's actual reply, releases the lock, waits a real 60–75 seconds, and verifies reactivation. Diagnostic samples show the existing tasks-moments deadlines remain present: the passing check does not disable plugin polling. Its RSS includes the server/test harness in the same process and is **not** A12 worker-memory evidence.

## Original failures retained

- Cloud first focused attempt: **33 passed / 1 failed / 0 skipped**, caused by the new test using an undefined `request` helper instead of the existing `post`; corrected without changing product assertions. The original failure count and cause remain here. The matching initial typecheck reported three TS2552 sites. One command used the wrong cwd and did not produce a gate result.
- Targeted build attempts 1–3 failed during the package migration and parallel PG/shared-host edits: missing HostFacts/wrong moved imports, in-progress host-wiring types, and a cross-root PG test helper import. Original diagnostic excerpt: `error TS18048: 'a.quotaPoller' is possibly 'undefined'.`; later successful builds do not replace them.
- Lifecycle attempts 1–3 each failed the real 80-second idle wait. The first investigation removed unconditional outbound polling; diagnostics then demonstrated that the legitimate tasks-moments polling also renewed `used`. The shared root fix is the worker's distinction between source-message/runtime activity and deterministic polling. All three failed attempts remain recorded above.
- A final size check failed with background.ts at 501 lines after the formatter restored an import separator. One interface separator was removed; the file remains formatted at 500 lines. No size baseline was added. `摘录：→ 拆分到 500 行以内；确需保留则登记到 scripts/file-size-baseline.json 并写明待拆理由` and `摘录：✓ 通过：0 个文件在基线内且未增长` preserve both outcomes.

The redundant queued `closed` check and activation catch/rethrow were removed. A shutdown check remains inside the actual capacity-wait loop, where waiting work can wake after close; it is a reachable cancellation boundary, not an impossible-state defense. Promise cleanup uses the two settled branches instead of stacked `finally().catch()` cleanup chains.
