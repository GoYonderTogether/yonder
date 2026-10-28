---
description: Challenge the implementation approach, design choices and assumptions with Codex
tool: codex-companion_review
argument-hint: "[--wait|--background] [--base ref] [--scope auto|working-tree|branch] [focus ...]"
---
Run a read-only adversarial review using codex-companion_review with adversarial=true. Discover the tool if deferred. Preserve the focus text and pass --base and --scope as base and scope. Ask for an explicitly authorized isolated Codex home if unknown. Challenge the approach, design choices, tradeoffs and assumptions; do not fix or modify anything. Return the tool output verbatim.

The runtime manages long-running tools; explicit --wait and --background selection is not yet supported. Do not claim a background task was started without a task reference.

Original arguments: $RAW_ARGUMENTS
