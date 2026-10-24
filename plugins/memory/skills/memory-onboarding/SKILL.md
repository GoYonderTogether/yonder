---
name: memory-onboarding
description: Use when a memory.attention event arrives (first run, new source, stale WeChat archive, or backlog), or when the owner asks to continue setting up their memory sources. Walks through the owner's sources one at a time, one question per message.
---

# Memory onboarding

A `memory.attention` event means the memory plugin noticed something that needs a decision. It carries `reason` and an `audit`. Nothing has been changed yet, and nothing should be until the owner agrees.

The agent that talks with the owner runs this skill, because the owner's answers arrive in its conversation. The background `memory-keeper` has no way to hear a reply: it does the heavy work (imports, organizing, cron jobs) when asked, and only reports.

## One question per message

Ask exactly one question, then stop and wait. Do not send the audit, the plan and several options together. After the answer, act on it, say what you did in one line, then ask the next question. Keep the first message to the single most useful thing: what was found and the one decision it needs.

## Walk the sources one at a time

Work through the sources in this order, finishing one before opening the next:

1. WeChat. List the few chats with the most recent activity (names only). Ask which need to be followed, and at what level: `immediate`, `watch`, `periodic` (daily summary) or `silent` (archive only). Set the answer with `wechat-archive_policy`. Chats the owner does not name stay `silent`.
2. Chat channels (Feishu and others). Ask which conversations should be recorded. Never widen the allowed conversations yourself; tell the owner the configuration line to add.
3. Registered folders (legacy vault, the owner's own notes). Say they are read-only. Ask only whether to index them.
4. Rhythms. Offer the evening wrap and weekly review first; the morning brief and monthly plan only if asked.

Before asking about a source, check that it has not already been done: search memory for `onboarding:`. After each source is settled, record one short note with `memory_capture`, for example `onboarding: wechat done`. The note is how the next conversation, or the next day, continues from the right place.

## Cost

When the audit shows a price, state the estimate once, with the first source that uses it: input tokens only, a single pass, an estimate and not a bill. With no price, give tokens only.

## Reasons

- `first-run`: start with the walk above.
- `source-new`: audit the new source, then ask the one question for it.
- `source-stale`: the WeChat archive stopped syncing. Say so and since when, and ask the owner to check `wechat-context`. Do not touch keys or permissions.
- `backlog`: ask whether the keeper should run a triage pass.

When a source is settled call `memory_bootstrap` with `op: "ack"` and the `reason`. If the owner says "not now", pass `snoozeDays`.

## Never

- Do not create agents, enable rituals or import anything the owner has not agreed to.
- Do not read chats outside the configured WeChat list.
- Do not describe an estimate as a bill.
