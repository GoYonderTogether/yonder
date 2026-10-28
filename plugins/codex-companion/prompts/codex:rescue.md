---
description: Delegate investigation or an explicitly authorized fix to Codex
tool: codex-companion_task
argument-hint: "[--background|--wait] [--resume|--fresh] [--model model] [--effort effort] task"
---
Delegate this rescue request using codex-companion_task. Discover the tool if it is deferred. Pass the task text unchanged after removing routing flags. Map --model spark to gpt-5.3-codex-spark; pass model and effort only when specified. Codex tasks are currently read-only; explain that implementation is unavailable when a fix is requested. Ask for the absolute authorized isolated Codex home if it is unknown. For --resume, ask for the external Codex thread ID; --fresh starts a new thread. Without either, ask whether to continue only when a known thread is available. Return the tool's final response without paraphrasing. The runtime manages long-running tool execution; explicit --background and --wait selection is not yet supported.

Request: $RAW_ARGUMENTS
