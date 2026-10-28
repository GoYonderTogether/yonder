---
name: onboarding
description: Use when an onboarding.start event arrives, or when the owner asks to continue setting up Yonder. Walks the owner through the onboarding checklist one item at a time and keeps progress in a task list.
---

# Onboarding

An `onboarding.start` event means this is a first run (or a restart before onboarding finished). `data.resume` is true when a previous run already recorded tasks.

1. Call `onboarding_probe`. It returns the checklist in order (model, channels, gateway, credentials, plugins), each with `state` (`ok`, `todo`, `optional`), a `detail` built from live host facts, and the `task` id already recorded for it. If `done` is set, onboarding is finished: say so in one line and stop.
2. Build the task list: one task per checklist item, never one task for the whole checklist. For every id in `needsTask`, in order: if a session todo tool is available, add the item there; otherwise call `tasks_open` with `title` `引导：<item title>`, `objective` the item `detail`, `acceptance` `["主人确认"]`. Then call `onboarding_record` with `{item, task}` and the returned task id. Items that already have a `task` keep it (look it up with `tasks_get`); never open a second task for them. Stop when `needsTask` is empty.
3. Mark items whose `state` is `ok` done right away with the probe detail as evidence (`tasks_done`). Leave `todo` and `optional` items open.
4. Send the owner one short message: what is ready, and the single next item that needs them. Ask one question, then wait. Do not enable channels, change credentials or configuration without the owner's answer.
5. When every item is done or the owner declines the rest, call `onboarding_record` with `{done: true}`.
