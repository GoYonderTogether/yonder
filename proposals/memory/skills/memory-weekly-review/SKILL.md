---
name: memory-weekly-review
description: Use for the weekly review. Drafts the review, runs health checks on the memory, proposes next week's plan, and closes the week.
---

# Weekly review

Run unattended. You propose; the owner confirms in conversation. You cannot commit or confirm.

## Steps

1. `memory_review` `pending`. Finish anything still unorganized, using the same rules as the evening wrap.
2. `memory_plan` `get` (week) and read the week with `memory_read` (`week`). Note which planned items are done, postponed, dropped.
3. Write the review with `memory_review` `section` (week, `复盘`, mode `replace`): what happened, what moved, what slipped and why, one lesson at most. Facts from the records only.
4. Health checks, report problems instead of fixing them silently:
   - contradictions between `confirmed` entries in `me/`: list both, do not choose
   - `me/now` entries not touched for a long time: ask whether they are still true
   - `inferred` entries older than two weeks: ask to confirm or drop
   - a `me/` file that is too long to fit its context budget: propose what to merge
   - records still unorganized after a week
5. Propose next week with `memory_plan` `propose` (week, next period): carry over what still matters, mark carried items with their postponement count, and keep the list short. Fewer items beats a full list.
6. `memory_review` `close`. If it refuses because the review is empty, fix that first.

## Message

Owner's language. What went well, what slipped, the problems from step 4 (only real ones), and the proposed plan in a short list. End with a single question: which of the proposed items to confirm. Do not ask several questions.
