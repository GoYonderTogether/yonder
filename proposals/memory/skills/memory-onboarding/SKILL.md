---
name: memory-onboarding
description: Use when a memory.attention event arrives (first run, new source, stale WeChat archive, or backlog). Shows the owner what was found and what it would cost, then sets things up only after they say yes.
---

# Memory onboarding

A `memory.attention` event means the memory plugin noticed something that needs a decision. It carries `reason` and an `audit`. Nothing has been changed yet, and nothing should be until the owner agrees.

## Steps

1. Read the event. Call `memory_bootstrap` with `op: "audit"` if the embedded audit is missing or old.
2. Tell the owner, in their language and in a few lines: what was found (sizes per source), the rough token count, and the estimated input cost if a price is present. Say plainly that the cost is an estimate: input tokens only, a single pass. If no price is available, give tokens only and do not guess a price.
3. Propose a plan that fits the `reason`:
   - `first-run`: create the background agent `memory-keeper`, turn on the evening wrap and weekly review, import registered sources. Offer the morning brief and monthly plan as optional.
   - `source-new`: audit the new source, then propose importing it.
   - `source-stale`: the WeChat archive has stopped syncing. Say so, say since when, and ask the owner to check `wechat-context`. Do not try to fix keys or permissions yourself.
   - `backlog`: propose a triage pass by the keeper, with the same cost framing.
4. Wait for the owner's reply. A question is not a yes. Do nothing else until you have a clear one.
5. After a clear yes, do only what was agreed: create the keeper with `yonder agents` from the `memory-keeper` preset (needs exec), add the cron jobs and bindings that were agreed, start imports with `memory_import`. Report each step as it succeeds or fails, with the real error text.
6. Call `memory_bootstrap` with `op: "ack"` and the `reason`. If the owner said "not now", pass `snoozeDays`.

## Never

- Do not create agents, enable rituals or import anything on your own.
- Do not read chats outside the configured WeChat list.
- Do not describe an estimate as a bill.
