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
`6214e3d`.

Optional bookmark action semantics also adapt `src/bookmark-tools.ts` at the
same f9b180b source, rebased onto upstream main 6214e3d.

Latest-source reconciliation: 6214e3d runner UTF-8 streaming fix is adapted;
canonical skill references are synchronized from the matched fork. Existing
Yonder operation surface/ownership stays intact; upstream incognito/video/debug
CLI capabilities are not implicitly exposed by this plugin. Optional extension
management uses Chrome native management API via fork commit
8500bcbdf2e6bf0d19c33a9b156ba62a07f85ade (MIT). The fork is
https://github.com/zoran-xc/BrowserSkill/tree/yonder/bookmarks-0.3.3.
