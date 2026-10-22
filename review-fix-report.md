# Advisory routing independent-review fixes

Date: 2026-10-22  
Base: `020c7e3ed09c7b1a9007e611b5cc1665486bfc69` in `/tmp/yonder-adaptive-routing-20261022/worktree`  
Scope: local advisory-only corrections for `/tmp/yonder-adaptive-routing-review-20261022/report.md`. No admission hook, frozen-design implementation, production activation, real classifier/auth, external message, PR creation, or push.

## Findings addressed

- **F-1 provenance:** removed the `ownerChoice` bypass. Public tool input is now `callerPreference`, explicitly documented as model-callable, untrusted advisory data—not an authenticated human choice. It is sent only as classifier context and cannot skip classification or policy validation. A future trusted explicit choice must be sourced from host-provided read-only context, not arguments; this change does not implement that future source.
- **Adversarial arguments and trust boundaries:** added checks proving forged argument fields cannot establish `agent`, conversation, or capabilities; the plugin uses host `ToolContext`. Added policy tests for hostile preference against target-model, effort, classifier model/origin and USD-bound constraints. No argument can self-authorize these constraints.
- **Input size:** bounded route count (1–12), route ID (≤32 chars), model label (≤128), effort label (≤16), and description (≤256). `summaryMaxBytes` now covers the UTF-8 serialized aggregate of summary, optional preference, and all candidate metadata—not only summary. README documents these semantics.
- **Cost/effort claims:** README explicitly states USD values are estimates/reservations, not provider metering, a hard billing ceiling, or an atomic spend reservation; dispatch timeout can leave billing unknown. Existing advisory effort resolution remains catalog-level and unapplied; provider-specific effort support/application is not claimed.
- **Lint hygiene:** formatted new decision-routing code, package manifest and the previously unformatted optional-plugin doctor test. No unrelated repository files were reformatted or changed. No new lint errors remain; unrelated existing warnings were left untouched.

## Validation

- `npx tsc -b --force`: **PASS** (pure TypeScript project build/typecheck).
- Targeted loader/doctor/advisory command: `npx vitest run packages/cli/src/index.test.ts packages/core/src/plugins/index.test.ts plugins/decision-routing/test/advisory.test.ts`: **PASS, 30 tests** (doctor 5, loader 4, advisory 21).
- `npm test`: **PASS, 407 passed, 34 skipped**, 94 test files passed and 17 skipped (441 total tests); credential/live/model-gated tests remain skipped. No paid/live classifier invoked.
- `npm run lint`: **PASS** exit 0; Biome reports 318 repository-wide pre-existing warnings and 9 infos. Relevant changed files have no diagnostics. Warnings elsewhere were not repaired as unrelated work.
- `git diff --check`: **PASS**.

## Disposition and limits

This is local advisory-only PR-ready source work, not a PR or remote delivery. The plugin remains disabled unless explicitly configured/approved, and still never submits a target model or changes input admission. No host-authenticated owner-choice path, live pricing guarantee, vendor-level effort validation, deployment, or production behavior was tested or added. This fix is not approval for a task-only execution design.
