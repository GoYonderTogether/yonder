---
name: memory-evening-wrap
description: Use for the evening ritual. Goes through today's unorganized records, files what matters, ticks them off, and sends the owner one short message.
---

# Evening wrap

Run unattended. You cannot confirm anything for the owner: your runs are not triggered by their messages, so `commit` and `confirm` will be refused. Propose, don't commit.

## Steps

1. `memory_review` `pending` for the current week. If nothing is pending, reply NO_REPLY.
2. Read the batch. For each record choose a destination and remember it:
   - a task or intention → `memory_plan` `propose` (week), destination `plan`
   - a fact the owner stated about themselves → `memory_me` `add`. Use `confirmed` only when you can cite a `{chat}` or `{wechat-self}` record id as `evidence`; otherwise `inferred`. Destination `me/now`, `me/profile` or `me/mind`.
   - a decision with options and a reason → `memory_review` `section` (week, `决定`) using the five fixed lines (背景 / 选项 / 选择 / 理由 / 复查日). Destination `decision`.
   - something a person or agent produced → `memory_review` `section` (week, `产出`) with a link. Destination `output`.
   - a project mention → `project:<name>`
   - chatter with no lasting value → `none`
3. Then `memory_review` `organize` with all `{ id, to }` pairs. Never edit record text. If a record is ambiguous, leave it unorganized and mention it.
4. Do not invent. Anything absent from the records stays out.

## Message

One message, owner's language, at most six lines: how many records filed, the most important new fact or decision, anything left open that needs them, and tomorrow's one most important item if the plan has one. No greeting, no summary of your process.
