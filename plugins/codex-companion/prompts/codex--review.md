---
command: codex:review
description: Run a Codex code review against local git state
tool: codex-companion_review
argument-hint: "[--wait|--background] [--base ref] [--scope auto|working-tree|branch]"
---
Run codex-companion_review without modifying files. Pass --base and --scope as base and scope. Ask for the authorized Codex home if unknown. For --wait set executionMode=wait; for --background set executionMode=background. If neither is specified, ask the user to choose waiting or background. Background returns a /bg handle and completion is delivered automatically. Return the review output verbatim.

Original arguments: $RAW_ARGUMENTS
