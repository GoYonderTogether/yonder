# Scratch log cleanup correction

The previous cleanup audit was wrong. **155 deletion actions included 9 referenced evidence logs (16,508 bytes): 146 were valid scratch removals; 9 were mistakes.** The earlier claims that every deletion was unreferenced and that no unreferenced logs remained are withdrawn. Deletion has stopped.

## Cause and corrected matching

The parser did not resolve `../review-*.log` against the referring committed verification document directory. It also prepended an implicit wildcard to exact tokens, so generic `build-final.log` and `typecheck.log` references falsely retained unrelated longer filenames. Correct matching now resolves relative paths, preserves qualified directories, uses complete basename equality, and expands only explicit brace/named-prefix groups. This administrative audit is excluded from retention-reference evidence. Four runnable assertions covering those cases passed; no product or full validation gate was rerun.

## Mistaken deletions and recovery

Root restored **7 complete files directly from their original captured tool stdout**, checking command/file boundaries and original byte lengths. No test was rerun to manufacture an old log. **2 full original raw files remain unavailable**; only genuine captured fragments and the committed original counts survive. Excerpts are not complete original logs.

| Mistakenly deleted file | Original bytes | Recovery | Committed reference |
|---|---:|---|---|
| `docs/verification/review-artifact-focused-final-2.log` | 557 | Fully restored from original tool stdout | `docs/verification/fix-round/verification.md:35` |
| `docs/verification/review-events-focused-2.log` | 201 | Fully restored from original tool stdout | `docs/verification/fix-round/verification.md:37` |
| `docs/verification/review-events-focused.log` | 1196 | Fully restored from original tool stdout | `docs/verification/fix-round/verification.md:37` |
| `docs/verification/review-shutdown-focused-final.log` | 203 | Fully restored from original tool stdout | `docs/verification/fix-round/main-content-audit.md:100` |
| `docs/verification/review-shutdown-negative-control.log` | 1176 | Fully restored from original tool stdout | `docs/verification/fix-round/main-content-audit.md:100` |
| `docs/verification/review-storage-focused-2.log` | 7187 | Full original missing; genuine fragments only (44 pass / 6 fail) | `docs/verification/fix-round/verification.md:35` |
| `docs/verification/review-storage-focused-3.log` | 556 | Fully restored from original tool stdout | `docs/verification/fix-round/verification.md:35` |
| `docs/verification/review-storage-focused-4.log` | 1497 | Full original missing; genuine fragments only (54 pass / 1 fail) | `docs/verification/fix-round/verification.md:35` |
| `docs/verification/review-storage-focused-first.log` | 3935 | Fully restored from original tool stdout | `docs/verification/fix-round/verification.md:35` |

The reference documents were already committed before the erroneous deletion (including `3846fffd`/`8833abb3` verification ledger and `b50c0fcf` main audit). None of these references was added to disguise the mistake. The original files were untracked; reachable Git history and the two allowed worktrees contained no complete backup for the two still-missing raw logs.

## Remaining unreferenced logs observed during correction

The corrected pass found the following 10 logs without a committed verification reference at that observation snapshot. All were untracked. **No further deletion was performed**; the primary agent owns any subsequent explicit cleanup or new precise verification reference. This is a snapshot, not another zero-issues claim.

| Repository | Path | Bytes at observation |
|---|---|---:|
| yonder | `docs/verification/fix-round/closeout-lint.log` | 13941 |
| yonder | `docs/verification/review-storage-typecheck-final.log` | 0 |
| yonder | `docs/verification/shared-bot-core/stage-11-focused-local-typecheck.log` | 0 |
| yonder | `docs/verification/shared-bot-core/stage-9-server-build.log` | 65 |
| yonder | `docs/verification/shared-bot-core/stage-9-server-cloud-build.log` | 5792 |
| yonder | `docs/verification/shared-bot-core/stage-9-server-cloud-typecheck.log` | 58 |
| yonder | `docs/verification/shared-bot-core/stage-9-server-typecheck.log` | 78 |
| yonder | `docs/verification/stage-11-focused-host-request-typecheck-1.log` | 0 |
| cloud | `docs/verification/fix-round/cloud-server-typecheck.log` | 78 |
| cloud | `docs/verification/fix-round/cloud-web-typecheck.log` | 58 |

The JSON retains every prior deletion action with its corrected classification, the seven complete recoveries, the two partial-only originals, and parser check results. No source, report, BRIEF or unrelated evidence was changed by this correction.

## Primary-agent recovery and explicit follow-up cleanup

The primary agent recovered seven complete originals directly from the recorded stdout of this task's original commands, without manual transcription or rerunning a test. SHA256 and exact artifact sizes are committed in [log-recovery.json](log-recovery.json). The two unrecoverable complete raw files retain only explicitly named captured-output/head/tail artifacts and their original 44/6 and 54/1 counts; they are not represented as full originals. All final acceptance raw evidence and both original full-suite failure logs remain committed.

After the corrected exact-reference pass, the primary agent explicitly removed the ten untracked logs in the above correction snapshot. Thus **165 deletion actions comprise 156 valid scratch removals and 9 mistaken removals; seven mistaken originals are restored and two full originals are only partially recoverable**. The earlier clean-zero conclusions remain withdrawn; the missing raw originals are an explicit delivery limitation. The ten follow-up removals total 20,070 bytes; full file-by-file provenance remains in the JSON.
