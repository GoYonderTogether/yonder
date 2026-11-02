# Scratch log cleanup audit

Cleanup round 1 completed. Only untracked, unreferenced `.log` scratch files were deleted; no source, Markdown, JSON, BRIEF or report was removed. This inventory lists administrative actions and does not make an evidence-retention reference to its paths.

Committed verification reference snapshots:

- yonder: `658713ed7408f57fc6fa820482f57c2fa106828b`
- cloud: `e6fd63d4ed4b6297457fd9881c08cdc4909ce1f3`

| Repository | Committed reference retained | Active validation held | Tracked unresolved held | Scratch deleted |
|---|---:|---:|---:|---:|
| yonder | 332 | 12 | 0 | 145 |
| cloud | 18 | 0 | 0 | 6 |

Deleted bytes: 1159325. No tracked log was deleted.

The JSON records each observed log and the first committed document/line proving retention. Brace groups, explicit named prefixes and suffix shorthand are expanded. Active A12 and latest verification logs remain temporarily held; root will make exact final evidence references, then request one last refresh.

## Deleted scratch files

| Repository | Path | Bytes |
|---|---|---:|
| yonder | `docs/verification/fix-round/evidence-format.log` | 42 |
| yonder | `docs/verification/fix-round/focused-main-migration.log` | 1341 |
| yonder | `docs/verification/fix-round/migration-biome-clean.log` | 44 |
| yonder | `docs/verification/fix-round/migration-biome-final.log` | 15832 |
| yonder | `docs/verification/fix-round/migration-format-final.log` | 168 |
| yonder | `docs/verification/fix-round/migration-format-remainder.log` | 166 |
| yonder | `docs/verification/fix-round/speech-regression-2.log` | 978 |
| yonder | `docs/verification/fix-round/speech-regression.log` | 1201 |
| yonder | `docs/verification/fix-round/typecheck-core-removal-2.log` | 4195 |
| yonder | `docs/verification/fix-round/typecheck-core-removal.log` | 3234 |
| yonder | `docs/verification/fix-round/typecheck2.log` | 0 |
| yonder | `docs/verification/review-artifact-final-format.log` | 5208 |
| yonder | `docs/verification/review-artifact-focused-final-2.log` | 557 |
| yonder | `docs/verification/review-artifact-focused-final.log` | 557 |
| yonder | `docs/verification/review-artifact-format.log` | 2460 |
| yonder | `docs/verification/review-artifact-guard-format.log` | 39 |
| yonder | `docs/verification/review-console-focused.log` | 202 |
| yonder | `docs/verification/review-events-focused-2.log` | 201 |
| yonder | `docs/verification/review-events-focused.log` | 1196 |
| yonder | `docs/verification/review-events-format.log` | 14843 |
| yonder | `docs/verification/review-gate-failures-focused-2.log` | 201 |
| yonder | `docs/verification/review-gate-failures-focused.log` | 3069 |
| yonder | `docs/verification/review-host-scheduler-focused.log` | 200 |
| yonder | `docs/verification/review-load-format.log` | 39 |
| yonder | `docs/verification/review-plugin-bind-focused.log` | 200 |
| yonder | `docs/verification/review-plugin-bind-format.log` | 37 |
| yonder | `docs/verification/review-remote-search-lint.log` | 2864 |
| yonder | `docs/verification/review-scheduler-format.log` | 38 |
| yonder | `docs/verification/review-shutdown-build-first.log` | 0 |
| yonder | `docs/verification/review-shutdown-focused-final.log` | 203 |
| yonder | `docs/verification/review-shutdown-focused-first.log` | 203 |
| yonder | `docs/verification/review-shutdown-format.log` | 17804 |
| yonder | `docs/verification/review-shutdown-negative-control.log` | 1176 |
| yonder | `docs/verification/review-shutdown-test-format.log` | 859 |
| yonder | `docs/verification/review-storage-focused-2.log` | 7187 |
| yonder | `docs/verification/review-storage-focused-3.log` | 556 |
| yonder | `docs/verification/review-storage-focused-4.log` | 1497 |
| yonder | `docs/verification/review-storage-focused-final.log` | 557 |
| yonder | `docs/verification/review-storage-focused-first.log` | 3935 |
| yonder | `docs/verification/review-storage-format-2.log` | 7272 |
| yonder | `docs/verification/review-storage-format-3.log` | 11044 |
| yonder | `docs/verification/review-storage-format-4.log` | 1356 |
| yonder | `docs/verification/review-storage-format-5.log` | 2424 |
| yonder | `docs/verification/review-storage-format-final.log` | 7886 |
| yonder | `docs/verification/review-storage-format.log` | 14810 |
| yonder | `docs/verification/review-storage-typecheck-2.log` | 4195 |
| yonder | `docs/verification/review-storage-typecheck-3.log` | 0 |
| yonder | `docs/verification/review-storage-typecheck-4.log` | 350 |
| yonder | `docs/verification/review-storage-typecheck-5.log` | 0 |
| yonder | `docs/verification/review-storage-typecheck-first.log` | 13757 |
| yonder | `docs/verification/review-worker-final-lint.log` | 9392 |
| yonder | `docs/verification/review-worker-final-size-format.log` | 43 |
| yonder | `docs/verification/review-worker-lifecycle-lint.log` | 3029 |
| yonder | `docs/verification/review-worker-lifecycle-server-build.log` | 65 |
| yonder | `docs/verification/review-worker-outbound-lint.log` | 1956 |
| yonder | `docs/verification/review-worker-outbound-test-lint.log` | 1357 |
| yonder | `docs/verification/shared-bot-core/stage-11-development-biome-final-small-verified.log` | 39 |
| yonder | `docs/verification/shared-bot-core/stage-11-development-biome-final-small.log` | 4546 |
| yonder | `docs/verification/shared-bot-core/stage-11-development-biome-first.log` | 19130 |
| yonder | `docs/verification/shared-bot-core/stage-11-development-layer-first.log` | 264 |
| yonder | `docs/verification/shared-bot-core/stage-11-development-local-format.log` | 14455 |
| yonder | `docs/verification/shared-bot-core/stage-11-development-resources-format.log` | 40 |
| yonder | `docs/verification/shared-bot-core/stage-11-development-size-first.log` | 226 |
| yonder | `docs/verification/shared-bot-core/stage-11-development-source-format.log` | 9657 |
| yonder | `docs/verification/shared-bot-core/stage-11-focused-channel-scope-biome.log` | 19010 |
| yonder | `docs/verification/shared-bot-core/stage-11-focused-last-callers-verified.log` | 1136 |
| yonder | `docs/verification/shared-bot-core/stage-11-focused-source-second.log` | 583 |
| yonder | `docs/verification/shared-bot-core/stage-4-biome-in-progress.log` | 4523 |
| yonder | `docs/verification/shared-bot-core/stage-4-lock.log` | 135 |
| yonder | `docs/verification/shared-bot-core/stage-5-development-state-biome.log` | 9016 |
| yonder | `docs/verification/shared-bot-core/stage-6-development-lock-verified.log` | 135 |
| yonder | `docs/verification/shared-bot-core/stage-6-development-lock.log` | 135 |
| yonder | `docs/verification/shared-bot-core/stage-6-development-memory-biome.log` | 16094 |
| yonder | `docs/verification/shared-bot-core/stage-6-development-new-tests-biome.log` | 2066 |
| yonder | `docs/verification/shared-bot-core/stage-6-development-second-biome.log` | 14385 |
| yonder | `docs/verification/shared-bot-core/stage-6-development-storage-biome.log` | 11265 |
| yonder | `docs/verification/stage-10-evidence-format.log` | 41 |
| yonder | `docs/verification/stage-10-focused-biome-final.log` | 14031 |
| yonder | `docs/verification/stage-10-focused-biome-harness-final.log` | 43 |
| yonder | `docs/verification/stage-10-focused-card-harness-biome-2.log` | 40 |
| yonder | `docs/verification/stage-10-focused-card-harness-biome-3.log` | 39 |
| yonder | `docs/verification/stage-10-focused-card-harness-biome-4.log` | 39 |
| yonder | `docs/verification/stage-10-focused-card-harness-biome-5.log` | 39 |
| yonder | `docs/verification/stage-10-focused-card-harness-biome.log` | 39 |
| yonder | `docs/verification/stage-10-focused-card-loopback-development-1.log` | 953 |
| yonder | `docs/verification/stage-10-focused-card-loopback-development-2.log` | 950 |
| yonder | `docs/verification/stage-10-focused-card-loopback-development-3.log` | 774 |
| yonder | `docs/verification/stage-10-focused-card-loopback-development-4.log` | 712 |
| yonder | `docs/verification/stage-10-focused-card-loopback-development-5.log` | 943 |
| yonder | `docs/verification/stage-10-focused-card-loopback-development-6.log` | 1025 |
| yonder | `docs/verification/stage-10-focused-card-loopback-development-7.log` | 1590 |
| yonder | `docs/verification/stage-10-focused-component-biome.log` | 42 |
| yonder | `docs/verification/stage-10-focused-delivery-biome.log` | 3865 |
| yonder | `docs/verification/stage-10-focused-delivery-test-biome-2.log` | 13949 |
| yonder | `docs/verification/stage-10-focused-delivery-test-biome.log` | 13949 |
| yonder | `docs/verification/stage-10-focused-layers-development-1.log` | 264 |
| yonder | `docs/verification/stage-10-focused-size-development-1.log` | 226 |
| yonder | `docs/verification/stage-6-development-typecheck-3.log` | 51 |
| yonder | `docs/verification/stage-6-focused-atomic-biome.log` | 37 |
| yonder | `docs/verification/stage-6-focused-biome-development.log` | 13805 |
| yonder | `docs/verification/stage-6-focused-biome-error-detail.log` | 1204 |
| yonder | `docs/verification/stage-6-focused-biome-verified.log` | 16787 |
| yonder | `docs/verification/stage-6-focused-layers.log` | 264 |
| yonder | `docs/verification/stage-6-focused-legacy-biome-2.log` | 3296 |
| yonder | `docs/verification/stage-6-focused-new-tests-biome.log` | 4906 |
| yonder | `docs/verification/stage-6-focused-size-verified.log` | 226 |
| yonder | `docs/verification/stage-6-focused-size.log` | 397 |
| yonder | `docs/verification/stage-6-focused-typecheck-verified.log` | 51 |
| yonder | `docs/verification/stage-7-development-biome-1.log` | 21143 |
| yonder | `docs/verification/stage-7-development-biome-2.log` | 21103 |
| yonder | `docs/verification/stage-7-development-guard-biome-2.log` | 3075 |
| yonder | `docs/verification/stage-7-development-guard-biome-3.log` | 2437 |
| yonder | `docs/verification/stage-7-development-guard-biome.log` | 1903 |
| yonder | `docs/verification/stage-7-development-install-2.log` | 135 |
| yonder | `docs/verification/stage-7-development-install.log` | 142 |
| yonder | `docs/verification/stage-7-development-layers-1.log` | 917 |
| yonder | `docs/verification/stage-7-development-layers-2.log` | 917 |
| yonder | `docs/verification/stage-7-development-layers-3.log` | 293 |
| yonder | `docs/verification/stage-7-development-layers-4.log` | 545 |
| yonder | `docs/verification/stage-7-development-maintenance-host-biome.log` | 15547 |
| yonder | `docs/verification/stage-7-development-new-tests-biome.log` | 2538 |
| yonder | `docs/verification/stage-7-focused-biome-development-full.log` | 637790 |
| yonder | `docs/verification/stage-7-focused-biome-development.log` | 20314 |
| yonder | `docs/verification/stage-7-focused-biome-format-development.log` | 45 |
| yonder | `docs/verification/stage-7-focused-codegraph-diff-verified.log` | 0 |
| yonder | `docs/verification/stage-7-focused-codegraph-format-verified.log` | 44 |
| yonder | `docs/verification/stage-7-focused-diff-verified.log` | 0 |
| yonder | `docs/verification/stage-7-focused-format-verified.log` | 44 |
| yonder | `docs/verification/stage-7-focused-layers-verified.log` | 264 |
| yonder | `docs/verification/stage-7-focused-size-development.log` | 226 |
| yonder | `docs/verification/stage-8-development-biome-imports.log` | 42 |
| yonder | `docs/verification/stage-8-development-format.log` | 42 |
| yonder | `docs/verification/stage-8-development-install.log` | 88 |
| yonder | `docs/verification/stage-8-development-typecheck-10.log` | 0 |
| yonder | `docs/verification/stage-8-development-typecheck-11.log` | 0 |
| yonder | `docs/verification/stage-8-development-typecheck-12.log` | 0 |
| yonder | `docs/verification/stage-8-development-typecheck-2.log` | 0 |
| yonder | `docs/verification/stage-8-development-typecheck-3.log` | 2356 |
| yonder | `docs/verification/stage-8-development-typecheck-4.log` | 0 |
| yonder | `docs/verification/stage-8-development-typecheck-5.log` | 0 |
| yonder | `docs/verification/stage-8-development-typecheck-6.log` | 0 |
| yonder | `docs/verification/stage-8-development-typecheck-7.log` | 0 |
| yonder | `docs/verification/stage-8-development-typecheck-8.log` | 0 |
| yonder | `docs/verification/stage-8-development-typecheck-9.log` | 271 |
| yonder | `docs/verification/stage-9-evidence-format.log` | 39 |
| cloud | `docs/verification/fix-round/cloud-deploy-tests.log` | 2100 |
| cloud | `docs/verification/fix-round/cloud-market-tests.log` | 1287 |
| cloud | `docs/verification/fix-round/cloud-render-tests.log` | 384 |
| cloud | `docs/verification/fix-round/cloud-server-build.log` | 65 |
| cloud | `docs/verification/fix-round/cloud-server-tests.log` | 23995 |
| cloud | `docs/verification/fix-round/cloud-web-build.log` | 5792 |

## Temporarily held active validation logs

| Repository | Path |
|---|---|
| yonder | `docs/verification/fix-round/A12-diagnostic-before-fix-2.log` |
| yonder | `docs/verification/fix-round/A12-diagnostic-before-fix.log` |
| yonder | `docs/verification/fix-round/A12-diagnostic-format-2.log` |
| yonder | `docs/verification/fix-round/A12-diagnostic-format.log` |
| yonder | `docs/verification/fix-round/A12-model-binding-focused.log` |
| yonder | `docs/verification/fix-round/A12-model-binding-format-2.log` |
| yonder | `docs/verification/fix-round/A12-model-binding-format.log` |
| yonder | `docs/verification/fix-round/A12-model-binding-load-after-fix.log` |
| yonder | `docs/verification/fix-round/A12-model-binding-typecheck-2.log` |
| yonder | `docs/verification/fix-round/yonder-verified-build.log` |
| yonder | `docs/verification/fix-round/yonder-verified-lint.log` |
| yonder | `docs/verification/fix-round/yonder-verified-tests.log` |
