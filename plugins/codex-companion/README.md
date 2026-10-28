# Codex companion

Select this optional plugin and its tools for a profile. Install the Codex CLI in the execution environment and supply an absolute `codexHome` containing an authorized login; the existing local Codex home may be supplied explicitly. No login is copied.

`/codex:review` and `/codex:adversarial-review` run read-only reviews. `/codex:rescue` delegates a task and can resume a thread selected from `codex-companion_candidates`, which lists up to 20 threads previously completed in the same Yonder session. An explicit thread ID can also be supplied. Set `executionMode` to `wait` or `background`; background uses the shared `/bg` lifecycle and completion delivery.

Tasks default to read-only. To permit a write request, configure this plugin with `writeEnabled: true` and grant the profile the `write` capability; the task must also set `write: true`. Codex then uses its `workspace-write` sandbox. Review always remains read-only. Long output uses the shared tool-output cache.

Review targeting follows pi-codex 0.1.1, Apache-2.0, https://github.com/quantmind-br/pi-codex.
