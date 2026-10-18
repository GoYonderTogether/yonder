# BrowserSkill attribution

Adapted from Tencent/BrowserSkill commit
`f9b180bccbc79bd507d1ce292901170ca66e2abf`:

- `packages/dsh-plugin-browserskill/src/runner.ts`: CLI execution/error/cancellation.
- `tools.ts`, `phase-one-tools-*.ts`, `sessions.ts`, `session-starts.ts`,
  `start-journal.ts`, `queue.ts`, `image.ts`: action mappings, input rules,
  request ownership/cleanup, serialization and image MIME detection semantics.
- `crates/bsk-cli/skill/`: complete CLI skill and references, with a Yonder overlay.

Copyright (c) 2026 Tencent. MIT license: see LICENSE.browser-skill.
Yonder adaptation replaces DSH APIs/UI with @yonder/sdk, scopes ownership to the
calling Yonder session, removes automatic retry/recovery loops and keeps only
native start-request ownership facts. No browser engine or DSH runtime is bundled.
Installation guidance checked against AGENT_INSTALL.md at
`d9a78aed47874459ae1e44523a597e42dd9acf99`.
