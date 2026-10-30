---
command: codex:rescue
description: Delegate investigation or an explicitly authorized fix to Codex
tool: codex-companion_task
argument-hint: "[--background|--wait] [--resume|--fresh] [--model model] [--effort effort] task"
---
Delegate using codex-companion_task. Pass the task text unchanged after removing routing flags. Map --model spark to gpt-5.3-codex-spark; pass model and effort only when specified. Ask for the authorized Codex home if unknown. For --fresh start a new thread; for --resume call codex-companion_candidates and let the user select a candidate or provide a thread ID. Without either flag, call codex-companion_candidates and ask whether to continue an available candidate or start fresh. Pass the selected ID as resume. Writing requires explicit writeEnabled configuration and write capability; set write=true only for an authorized implementation request. For --wait set executionMode=wait; for --background set executionMode=background. If neither is specified, ask the user to choose waiting or background. Background returns a /bg handle and completion is delivered automatically. Return the final response without paraphrasing.

Request: $RAW_ARGUMENTS
