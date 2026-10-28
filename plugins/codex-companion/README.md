# Codex companion

`/codex:rescue` is available when `codex-companion_task` is selected. It delegates read-only tasks and accepts an explicit external thread ID, model and effort; write requests are rejected until execution-environment path restrictions can be enforced. Automatic resume candidate selection and explicit background/wait routing remain pending. The Codex home must be isolated and independently authorized.

Rescue verification: a temporary Yonder home with the SiliconFlow credential slot called the task tool through the real model (1 test passed). An empty isolated Codex home was used; authenticated Codex execution and resume were not verified. See the task tests for local permission and template checks.

Optional native Codex review tool. Install the OpenAI Codex CLI (`npm install -g @openai/codex`) in the selected execution environment and supply an absolute `codexHome` containing an explicitly authorized login. The tool runs in that environment with read-only sandbox settings; it does not use the owner's default Codex home. Select the plugin and `codex-companion_review` for the profile. `scope` accepts `auto`, `working-tree`, or `branch`; `base` selects a branch comparison. Auto chooses the working tree when it contains tracked or untracked changes, otherwise compares the default branch. Runtime cancellation and output caching apply.

Set `adversarial` to challenge implementation choices, assumptions and tradeoffs; optional `focus` supplies the review focus and requires `adversarial: true`. This uses the same target selection and read-only execution boundary.

`/codex:adversarial-review` is available when the review tool is selected, and preserves raw arguments in its prompt. Explicit wait/background selection is not yet wired; completion notification and authenticated review remain unverified. `/codex:review` is not yet wired. Codex CLI and authentication are separate from the Yonder model provider.

Review targeting follows pi-codex 0.1.1, Apache-2.0, https://github.com/quantmind-br/pi-codex.

Verification (2026-10-28): `npx vitest run plugins/codex-companion/test/review.test.ts` passed 1 test using a temporary real Git repository and empty isolated Codex home. Empty working-tree and branch ranges, untracked selection, personal-home rejection and cancellation were exercised. The untracked Codex invocation was cancelled after four seconds; authenticated review, verbatim result, background notification, selection UI, token budget and cache indexing remain unverified. `npx biome check plugins/codex-companion` passed. `node scripts/check-file-size.mjs` failed on concurrent `packages/core/src/routing/index.ts` (522 lines). `npx tsc -b` failed in concurrent `kernel/index.ts` and `code-intel/src/diagnostic-mark.ts`; no error was reported for this plugin. The first test run was cancelled after the unauthenticated CLI did not complete promptly. No real Yonder model call was run.
